/**
 * asr.ts — AsrPort over the Workers AI REST API (M4).
 *
 * POST {endpoint}/client/v4/accounts/{accountId}/ai/run/{model} with
 * raw audio bytes; the response `result` is Schema-decoded so a
 * provider-side payload change is a typed PortError, never a silent
 * wrong metric. `fetch` and `readAudio` are injectable — the adapter
 * never guesses how blobs are stored (file://, r2://, stub:// are all
 * the caller's problem). Endpoint/model are options, not literals,
 * so the same adapter drives Whisper, a fine-tuned variant or a mock.
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schedule from "effect/Schedule";

import { AsrPort, AsrResult, PortError } from "@ktb/eval-dataset";

const WorkersAiResult = Schema.Struct({
	result: Schema.Struct({
		text: Schema.String,
		segments: Schema.optionalKey(
			Schema.Array(
				Schema.Struct({
					start: Schema.Number,
					end: Schema.Number,
					text: Schema.String,
				}),
			),
		),
	}),
	success: Schema.Boolean,
});

const decode = Schema.decodeUnknownSync(WorkersAiResult);

const fail = (message: string) => new PortError({ port: "asr", message });

export interface WorkersAiAsrOptions {
	readonly accountId: string;
	readonly apiToken: string;
	/** Provider model id (e.g. an ASR model alias) — required, no
	 * domain-level default: the caller pins the engine it benchmarks. */
	readonly model: string;
	/** Defaults to the public Workers AI API base. */
	readonly endpoint?: string;
	/** Resolves an AudioRef to bytes — inject store.getBlob or fs. */
	readonly readAudio: (uri: string) => Effect.Effect<Uint8Array, PortError>;
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
	/** Retry policy for transient 5xx/network failures. Default: none. */
	readonly retry?: Schedule.Schedule<unknown, PortError>;
}

export const makeWorkersAiAsr = (opts: WorkersAiAsrOptions): Layer.Layer<AsrPort> =>
	Layer.succeed(
		AsrPort,
		AsrPort.of({
			transcribe: (audio, callOpts) => {
				const started = Date.now();
				const fetchImpl = opts.fetchImpl ?? fetch;
				const timeoutMs = opts.timeoutMs ?? 60_000;
				const endpoint = opts.endpoint ?? "https://api.cloudflare.com";
				const url = `${endpoint}/client/v4/accounts/${opts.accountId}/ai/run/${opts.model}`;

				const request = opts.readAudio(audio.uri).pipe(
					Effect.flatMap((bytes) =>
						Effect.tryPromise({
							try: async () => {
								const res = await fetchImpl(url, {
									method: "POST",
									headers: {
										Authorization: `Bearer ${opts.apiToken}`,
										"Content-Type": "application/octet-stream",
									},
									body: bytes as unknown as BodyInit,
								});
								if (!res.ok) {
									throw new Error(`workers-ai ${res.status}: ${await res.text()}`);
								}
								return res.json() as Promise<unknown>;
							},
							catch: (e) => fail(e instanceof Error ? e.message : String(e)),
						}),
					),
					Effect.timeout(`${timeoutMs} millis`),
					Effect.mapError((e) =>
						e instanceof PortError ? e : fail(`timeout after ${timeoutMs}ms`),
					),
					Effect.flatMap((body) =>
						Effect.try({
							try: () => decode(body),
							catch: (e) => fail(`malformed response: ${String(e).slice(0, 200)}`),
						}),
					),
					Effect.flatMap((body) =>
						body.success
							? Effect.succeed(
									AsrResult.make({
										text: body.result.text,
										segments: (body.result.segments ?? []).map((s) => ({
											t0: s.start,
											t1: s.end,
											text: s.text,
										})),
										language: callOpts?.language,
									}),
								)
							: Effect.fail(fail("workers-ai returned success=false")),
					),
				);

				return (
					opts.retry !== undefined ? request.pipe(Effect.retry({ schedule: opts.retry })) : request
				).pipe(
					Effect.map((asr) => ({
						asr,
						record: {
							runId: "asr",
							taskId: audio.uri,
							stage: "transcribe",
							engine: `workers-ai:${opts.model}`,
							inputHash: audio.uri,
							startedAt: started,
							latencyMs: Date.now() - started,
						},
					})),
				);
			},
		}),
	);
