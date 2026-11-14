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
 *
 * PHI boundary: this adapter ships audio bytes to a third-party API —
 * voice is PHI under LGPD. Provenance is enforced on TWO channels:
 *
 * 1. Caller-declared `origin` (AsrPort opts) — `"real_anonymized"`
 *    refuses unless `allowRealAudio` is set; that flag exists only
 *    for trusted/self-hosted endpoints, never the public Workers AI
 *    API.
 * 2. Stored blob provenance — `callOpts.blobMeta` (pipeline-resolved)
 *    or the `readBlobMeta` lookup option. A recorded origin of
 *    `"real_anonymized"` or `"unknown"` refuses the same way: only
 *    verified-`synthetic` blobs may leave. `null`/absent meta means
 *    no store record — the documented bypass for URIs the store
 *    cannot see (e.g. `file://` paths resolved by `readAudio`).
 */

import { Schema } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Schedule from "effect/Schedule";

import { AsrPort, AsrResult, PortError, type BlobMeta } from "@ktb/eval-dataset";

const WorkersAiResult = Schema.Struct({
	// Optional so a success=false payload still decodes — the provider's
	// errors[]/messages[] are then surfaced in the PortError instead of
	// collapsing into "malformed response".
	result: Schema.optionalKey(
		Schema.Struct({
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
	),
	success: Schema.Boolean,
	errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
	messages: Schema.optionalKey(Schema.Array(Schema.Unknown)),
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
	/** Escape hatch for non-synthetic audio — ONLY for endpoints you
	 * operate yourself (self-hosted Workers-AI-compatible mock/proxy).
	 * Default false: real voice is PHI and must not reach the public
	 * Workers AI API; `unknown` provenance is treated the same. */
	readonly allowRealAudio?: boolean;
	/** Stored-provenance lookup for callers that bypass the pipeline —
	 * typically `store.getBlobMeta`. An explicit `callOpts.blobMeta`
	 * wins over this lookup. When NEITHER is supplied the adapter only
	 * sees the caller-declared `origin` (the documented bypass). A
	 * lookup failure propagates as a PortError — fail closed. */
	readonly readBlobMeta?: (uri: string) => Effect.Effect<BlobMeta | null, PortError>;
}

export const makeWorkersAiAsr = (opts: WorkersAiAsrOptions): Layer.Layer<AsrPort> =>
	Layer.succeed(
		AsrPort,
		AsrPort.of({
			transcribe: (audio, callOpts) =>
				Effect.gen(function* () {
					const started = Date.now();
					if (opts.allowRealAudio !== true) {
						// PHI gate channel 1: caller-declared origin — an
						// untrusted hint, checked before any I/O.
						if (callOpts?.origin === "real_anonymized") {
							return yield* Effect.fail(
								fail(
									"refusing real_anonymized audio: voice is PHI and must not reach a cloud ASR (set allowRealAudio only for a self-hosted endpoint)",
								),
							);
						}
						// PHI gate channel 2: provenance recorded ON the blob
						// at putBlob time. An explicit callOpts.blobMeta wins
						// (the pipeline already resolved it); otherwise the
						// readBlobMeta lookup covers direct port callers.
						// Neither supplied → declared-only check, the
						// documented bypass. Fails before readAudio/fetch —
						// no bytes leave the process.
						const stored =
							callOpts?.blobMeta !== undefined
								? callOpts.blobMeta
								: opts.readBlobMeta !== undefined
									? yield* opts.readBlobMeta(audio.uri)
									: undefined;
						const storedOrigin = stored?.origin;
						if (storedOrigin === "real_anonymized" || storedOrigin === "unknown") {
							return yield* Effect.fail(
								fail(
									`refusing audio with stored provenance "${storedOrigin}": only verified-synthetic blobs may reach a cloud ASR`,
								),
							);
						}
					}
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
										// Uint8Array is a valid fetch body at runtime;
										// TS's BodyInit just doesn't include ArrayBufferView.
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
						Effect.flatMap((body) => {
							if (!body.success) {
								// Surface the provider's own error payload — a bare
								// "success=false" hides rate-limit/auth/quota causes.
								const detail = [...(body.errors ?? []), ...(body.messages ?? [])]
									.map((e) => (typeof e === "string" ? e : JSON.stringify(e)))
									.filter((s) => s.length > 0)
									.join("; ")
									.slice(0, 300);
								return Effect.fail(
									fail(`workers-ai returned success=false${detail !== "" ? `: ${detail}` : ""}`),
								);
							}
							const result = body.result;
							if (result === undefined) {
								return Effect.fail(fail("malformed response: success=true without result"));
							}
							return Effect.succeed(
								AsrResult.make({
									text: result.text,
									segments: (result.segments ?? []).map((s) => ({
										t0: s.start,
										t1: s.end,
										text: s.text,
									})),
									// optionalKey rejects explicit undefined — omit
									// the key entirely when no language was asked.
									...(callOpts?.language !== undefined ? { language: callOpts.language } : {}),
								}),
							);
						}),
					);

					return yield* (
						opts.retry !== undefined
							? request.pipe(Effect.retry({ schedule: opts.retry }))
							: request
					).pipe(
						Effect.map((asr) => ({
							asr,
							record: {
								runId: "asr",
								taskId: audio.uri,
								stage: "transcribe",
								engine: `workers-ai:${opts.model}`,
								model: opts.model,
								inputHash: audio.uri,
								startedAt: started,
								latencyMs: Date.now() - started,
							},
						})),
					);
				}),
		}),
	);
