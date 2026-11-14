/**
 * asr.ts — local AsrPort backed by the faster-whisper HTTP service
 * (T-101).
 *
 * The Python service (`scripts/asr-server.py`) keeps the model warm —
 * this adapter is a thin, resilient HTTP client: POST the audio path,
 * Schema-decode the response (malformed payloads are typed PortErrors,
 * never silent), per-call timeout, caller-controlled retry Schedule.
 * `fetch` is injectable for tests.
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { AsrPort, AsrResult, PortError } from "@ktb/eval-dataset";

export interface LocalAsrOptions {
	readonly baseUrl: string;
	readonly fetchImpl?: typeof fetch;
	/** Per-call timeout in ms. Default 60_000 (CPU inference is slow). */
	readonly timeoutMs?: number;
	/** Retry policy for transient service failures. Default: none —
	 * timeouts on CPU inference are not cheap to repeat. */
	readonly retry?: Schedule.Schedule<unknown, PortError>;
}

const decodeResult = Schema.decodeUnknownSync(AsrResult);

const fail = (message: string) => new PortError({ port: "asr", message });

export const makeLocalAsr = (opts: LocalAsrOptions): Layer.Layer<AsrPort> =>
	Layer.succeed(
		AsrPort,
		AsrPort.of({
			transcribe: (audio, callOpts) => {
				const fetchImpl = opts.fetchImpl ?? fetch;
				const timeoutMs = opts.timeoutMs ?? 60_000;
				const started = Date.now();
				const path = audio.uri.startsWith("file://")
					? audio.uri.slice("file://".length)
					: audio.uri;

				const request = Effect.tryPromise({
					try: async () => {
						const res = await fetchImpl(`${opts.baseUrl}/transcribe`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								audio_path: path,
								language: callOpts?.language ?? "pt",
							}),
						});
						if (!res.ok) {
							throw new Error(`asr service ${res.status}: ${await res.text()}`);
						}
						return res.json() as Promise<unknown>;
					},
					catch: (e) => fail(e instanceof Error ? e.message : String(e)),
				});

				const guarded = request.pipe(
					Effect.timeout(`${timeoutMs} millis`),
					Effect.mapError((e) =>
						e instanceof PortError ? e : fail(`timeout after ${timeoutMs}ms`),
					),
					Effect.flatMap((body) =>
						Effect.try({
							try: () => decodeResult(body),
							catch: (e) => fail(`malformed response: ${String(e).slice(0, 200)}`),
						}),
					),
				);

				return (
					opts.retry !== undefined ? guarded.pipe(Effect.retry({ schedule: opts.retry })) : guarded
				).pipe(
					Effect.map((asr) => ({
						asr,
						record: {
							runId: "asr",
							taskId: audio.uri,
							stage: "transcribe",
							engine: "faster-whisper",
							inputHash: audio.uri,
							startedAt: started,
							latencyMs: Date.now() - started,
						},
					})),
				);
			},
		}),
	);
