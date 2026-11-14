/**
 * asr.ts — local AsrPort backed by the faster-whisper HTTP service
 * (T-101).
 *
 * The Python service (`scripts/asr-server.py`) keeps the model warm —
 * this adapter is a thin, resilient HTTP client: POST the audio path,
 * Schema-decode the response (malformed payloads are typed PortErrors,
 * never silent), per-call timeout, caller-controlled retry Schedule.
 * `fetch` is injectable for tests.
 *
 * Audio refs: only `file://` URIs are resolved — the scheme is
 * stripped (and percent-decoded) into a server-local path the Python
 * service reads directly. Other schemes are passed through raw and
 * will be rejected by the service (400). Blob/scheme resolution is
 * phase-2 work.
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
	/** Retry policy for TRANSIENT failures only — transport errors,
	 * 5xx responses, and timeouts. 4xx responses and malformed
	 * payloads are permanent and fail immediately. Default: none —
	 * timeouts on CPU inference are not cheap to repeat. */
	readonly retry?: Schedule.Schedule<unknown, PortError>;
	/** PHI egress declaration consumed by the domain policy
	 * (guardAsrPort in @ktb/eval-consult): `true` = audio may leave
	 * the perimeter, `false` = local-only. Default: auto-derived —
	 * loopback baseUrls are local-only, anything else egresses. Set
	 * explicitly when the service is remote-but-trusted. */
	readonly egress?: boolean;
}

/** Loopback-ish baseUrls — the whisper service reads server-local
 * paths, so anything reachable at these addresses is inside the
 * perimeter. Exported for the sibling HTTP adapters (eval.ts). */
export const isLoopbackUrl = (baseUrl: string): boolean => {
	// A bare path is a local socket/file endpoint.
	if (baseUrl.startsWith("/")) return true;
	// Extract the host — scheme optional, port/path excluded — so
	// "localhost.evil.com" is NOT mistaken for loopback.
	const host = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\[[^\]]*\]|[^/:?#]+)/i.exec(baseUrl)?.[1] ?? "";
	return (
		host === "localhost" ||
		// Strict IPv4 loopback — "127.evil.com" must not pass.
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
		host === "0.0.0.0" ||
		host === "[::1]"
	);
};

const decodeResult = Schema.decodeUnknownSync(AsrResult);

const fail = (message: string) => new PortError({ port: "asr", message });

/** PortError for deterministic failures that must NOT be retried —
 * repeating a 4xx or a schema-decode failure just burns the schedule.
 * Same `_tag` as PortError; the subclass marker is what `retry`'s
 * `while` predicate checks. */
class PermanentPortError extends PortError {}

const failPermanent = (message: string) => new PermanentPortError({ port: "asr", message });

/** Carries the HTTP status out of `tryPromise` so the catch can
 * classify 4xx (permanent) vs 5xx/other (transient). */
class HttpStatusError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** `file://` → server-local path. Percent-decodes so escaped paths
 * (spaces, unicode) resolve; a malformed escape falls back to the raw
 * slice rather than throwing a defect. Non-`file://` URIs pass
 * through untouched. */
const stripFileScheme = (uri: string): string => {
	if (!uri.startsWith("file://")) return uri;
	const raw = uri.slice("file://".length);
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
};

/** Only transient failures retry: transport errors, 5xx, timeouts.
 * PermanentPortError marks 4xx + decode failures as do-not-retry. */
const isTransient = (e: PortError) => !(e instanceof PermanentPortError);

export const makeLocalAsr = (opts: LocalAsrOptions): Layer.Layer<AsrPort> => {
	// Tolerate a trailing slash on baseUrl — `${baseUrl}/transcribe`
	// must not produce `//transcribe`.
	const baseUrl = opts.baseUrl.replace(/\/+$/, "");
	return Layer.succeed(
		AsrPort,
		AsrPort.of({
			egress: opts.egress ?? !isLoopbackUrl(baseUrl),
			transcribe: (audio, callOpts) => {
				const fetchImpl = opts.fetchImpl ?? fetch;
				const timeoutMs = opts.timeoutMs ?? 60_000;
				const started = Date.now();
				const path = stripFileScheme(audio.uri);

				const request = Effect.tryPromise({
					try: async () => {
						const res = await fetchImpl(`${baseUrl}/transcribe`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							// Abort the socket at the same deadline as the
							// Effect.timeout below — a hung service must not
							// leak the request.
							signal: AbortSignal.timeout(timeoutMs),
							body: JSON.stringify({
								audio_path: path,
								language: callOpts?.language ?? "pt",
							}),
						});
						if (!res.ok) {
							const body = (await res.text()).slice(0, 300);
							throw new HttpStatusError(res.status, `asr service ${res.status}: ${body}`);
						}
						return res.json() as Promise<unknown>;
					},
					catch: (e) => {
						if (e instanceof HttpStatusError) {
							// 4xx is deterministic (bad path, bad payload) —
							// permanent. 5xx/3xx-oddities stay transient.
							return e.status >= 400 && e.status < 500 ? failPermanent(e.message) : fail(e.message);
						}
						// Invalid JSON is as deterministic as a schema miss.
						if (e instanceof SyntaxError) return failPermanent(e.message);
						return fail(e instanceof Error ? e.message : String(e));
					},
				});

				const guarded = request.pipe(
					Effect.timeout(`${timeoutMs} millis`),
					Effect.mapError((e) =>
						e instanceof PortError ? e : fail(`timeout after ${timeoutMs}ms`),
					),
					Effect.flatMap((body) =>
						Effect.try({
							try: () => decodeResult(body),
							catch: (e) => failPermanent(`malformed response: ${String(e).slice(0, 200)}`),
						}),
					),
				);

				return (
					opts.retry !== undefined
						? guarded.pipe(Effect.retry({ schedule: opts.retry, while: isTransient }))
						: guarded
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
};
