/**
 * adapters.ts — capability id + adapter key → Effect Layer (P-074
 * phase 4).
 *
 * The composition root's job: turn a resolved `adapters` map
 * (capability → adapter key) plus a workdir/env into concrete port
 * layers. Adapter implementations live in the exempt-edge packages
 * (@ktb/eval-adapter-stub/-local/-cloud); this file only selects and
 * configures them. Non-stub adapters that need endpoints/credentials
 * read env vars and fail with a named-variable error, never a silent
 * default that would egress somewhere unintended.
 *
 * Persistence (store/report) is ALWAYS the local sqlite/jsonl pair
 * rooted at --workdir: the CLI's dataset lives on disk so `generate`,
 * `run`, `gate` and `report` compose across processes. The declared
 * cloud adapters (r2) are reported by `list`/resolution but not yet
 * wired here.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EvalPort, PortError, type EvalAnswer, type RunRecord } from "@ktb/eval-core";
import { AsrPort, LlmPort, TtsPort, type TaskEnvelope } from "@ktb/eval-consult";
import { makeWorkersAiAsr } from "@ktb/eval-adapter-cloud";
import {
	makeAcpLlm,
	makeJevEval,
	makeLocalAsr,
	makeLocalReportLayer,
	makeLocalStoreLayer,
	makeLocalTts,
	makeSystemOneEval,
	type AcpTransport,
} from "@ktb/eval-adapter-local";
import { CANNED_ASR, CANNED_EDITS, CANNED_SCRIPT } from "@ktb/eval-adapter-stub";

// ---------- stub port layers (deterministic, zero I/O) ----------

const stubRecord = (stage: string, taskId: string, engine: string): RunRecord => ({
	runId: "stub",
	taskId,
	stage,
	engine,
	inputHash: "stub",
	startedAt: 0,
	latencyMs: 0,
});

/** Same canned outputs as @ktb/eval-adapter-stub's makeStubLayer,
 * exposed per-port so the CLI can mix stub model ports with the
 * persistent local store/report. */
export const stubTtsLayer = Layer.succeed(
	TtsPort,
	TtsPort.of({
		egress: false,
		synthesize: ({ voiceId }) =>
			Effect.succeed({
				audio: { uri: `stub://tts/${voiceId}`, size: 8 },
				record: stubRecord("synthesize", voiceId, "stub-tts"),
			}),
	}),
);

export const stubAsrLayer = Layer.succeed(
	AsrPort,
	AsrPort.of({
		egress: false,
		transcribe: () =>
			Effect.succeed({
				asr: CANNED_ASR,
				record: stubRecord("transcribe", "stub-asr", "stub-asr"),
			}),
	}),
);

/* v8 ignore next -- every call site below only ever sees Error
 * instances (fs/JSON/fetch failures); the String() fallback is a
 * type-level safety net, not a reachable path */
const causeMessage = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause);

const stubAnswerOf = (q: {
	id: string;
	kind: string;
	options?: readonly string[];
}): EvalAnswer => ({
	id: q.id,
	kind: q.kind as EvalAnswer["kind"],
	value: q.kind === "noul" ? true : q.kind === "choice" ? (q.options?.[0] ?? "") : 0,
	probability: 0.95,
});

export const stubLlmLayer = Layer.succeed(
	LlmPort,
	LlmPort.of({
		egress: false,
		generate: (envelope: TaskEnvelope) =>
			Effect.succeed({
				text: CANNED_SCRIPT,
				record: stubRecord("script_gen", envelope.taskId, "stub-llm"),
			}),
		correct: (envelope: TaskEnvelope) =>
			Effect.succeed({
				edits: CANNED_EDITS,
				record: stubRecord("cleanup", envelope.taskId, "stub-llm"),
			}),
	}),
);

export const stubEvalLayer = Layer.succeed(
	EvalPort,
	EvalPort.of({
		egress: false,
		judge: (input) =>
			Effect.succeed({
				answers: input.questions.map(stubAnswerOf),
				record: stubRecord("judge", "stub-judge", "stub-eval"),
			}),
	}),
);

// ---------- env-configured adapters ----------

const env = (ctx: WireContext, name: string): string => {
	const v = ctx.env[name];
	if (v === undefined || v === "") {
		throw new Error(`adapter requires env ${name} (profile "${ctx.profile}")`);
	}
	return v;
};

/** `file://` → local path, CONFINED to `workdir` — the only place
 * eval audio legitimately lives (TTS output under `<workdir>/tts`,
 * dataset blobs under `<workdir>/blobs`). Anything else — absolute
 * paths outside the workdir, `..` escapes — is a typed PortError:
 * this reader feeds egress-capable cloud ASR, so an unconstrained
 * read would turn a crafted Sample into an arbitrary-file exfil
 * channel. Other schemes are rejected the same way (blob://
 * resolution is a caller concern). */
export const makeReadAudioFile =
	(workdir: string) =>
	(uri: string): Effect.Effect<Uint8Array, PortError> =>
		Effect.try({
			try: () => {
				if (!uri.startsWith("file://")) {
					throw new Error(`unsupported audio uri scheme (expected file://): ${uri}`);
				}
				const raw = uri.slice("file://".length);
				let p = raw;
				try {
					p = decodeURIComponent(raw);
				} catch {
					/* malformed escape — use the raw slice */
				}
				const root = path.resolve(workdir);
				// Relative refs resolve UNDER the workdir (absolute
				// paths pass through resolve unchanged, then the prefix
				// check below rejects anything outside).
				const resolved = path.resolve(root, p);
				if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
					throw new Error(`audio path escapes the run workdir: ${resolved}`);
				}
				return new Uint8Array(fs.readFileSync(resolved));
			},
			catch: (cause) =>
				new PortError({
					port: "asr",
					message: `readAudio ${uri}: ${causeMessage(cause)}`,
					cause,
				}),
		});

/** Minimal JSON-RPC transport for the ACP adapter: POST the encoded
 * AcpRequest to EVAL_ACP_URL, hand the decoded body back for
 * decodeTaskResult validation. */
export const makeHttpAcpTransport = (
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
	timeoutMs = 60_000,
): AcpTransport => {
	const url = baseUrl.replace(/\/+$/, "");
	return (request) =>
		Effect.tryPromise({
			try: async () => {
				const res = await fetchImpl(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					// Abort the socket at the same deadline as the caller's
					// Effect.timeout — a hung agent must not leak the request.
					signal: AbortSignal.timeout(timeoutMs),
					body: JSON.stringify(request),
				});
				if (!res.ok) {
					throw new PortError({
						port: "llm",
						message: `acp ${res.status}: ${(await res.text()).slice(0, 300)}`,
					});
				}
				return (await res.json()) as unknown;
			},
			catch: (cause) =>
				cause instanceof PortError
					? cause
					: new PortError({
							port: "llm",
							message: `acp transport: ${causeMessage(cause)}`,
							cause,
						}),
		});
};

// ---------- selection ----------

export interface WireContext {
	readonly workdir: string;
	readonly profile: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly fetchImpl?: typeof fetch;
}

const unknownAdapter = (cap: string, key: string): never => {
	throw new Error(`no adapter implementation for capability "${cap}" key "${key}"`);
};

const ttsLayer = (ctx: WireContext, key: string) => {
	switch (key) {
		case "stub":
			return stubTtsLayer;
		case "edge-tts":
			return makeLocalTts({ workDir: path.join(ctx.workdir, "tts"), voiceMap: {} });
		default:
			return unknownAdapter("tts", key);
	}
};

const asrLayer = (ctx: WireContext, key: string) => {
	switch (key) {
		case "stub":
			return stubAsrLayer;
		case "faster-whisper":
			return makeLocalAsr({
				baseUrl: ctx.env.EVAL_ASR_URL ?? "http://127.0.0.1:8765",
				...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
			});
		case "workers-ai": {
			const accountId = env(ctx, "EVAL_CF_ACCOUNT_ID");
			const apiToken = env(ctx, "EVAL_CF_API_TOKEN");
			const model = env(ctx, "EVAL_ASR_MODEL");
			const endpoint = ctx.env.EVAL_CF_API_ENDPOINT;
			return makeWorkersAiAsr({
				accountId,
				apiToken,
				model,
				readAudio: makeReadAudioFile(ctx.workdir),
				...(endpoint !== undefined && endpoint !== "" ? { endpoint } : {}),
				...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
			});
		}
		default:
			return unknownAdapter("asr", key);
	}
};

const llmLayer = (ctx: WireContext, key: string) => {
	switch (key) {
		case "stub":
			return stubLlmLayer;
		case "acp":
			return makeAcpLlm({
				transport: makeHttpAcpTransport(env(ctx, "EVAL_ACP_URL"), ctx.fetchImpl ?? fetch),
			});
		default:
			return unknownAdapter("llm", key);
	}
};

const evalLayer = (ctx: WireContext, key: string) => {
	switch (key) {
		case "stub":
			return stubEvalLayer;
		case "jev":
			return makeJevEval({
				baseUrl: env(ctx, "EVAL_JEV_URL"),
				...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
			});
		case "systemone": {
			// Self-hosted System One judge (OpenJev `wev serve`,
			// local-jev, …). MODEL is optional — servers treat it as
			// opaque; only set it for endpoints that validate names.
			const model = ctx.env.EVAL_SYSTEMONE_MODEL;
			return makeSystemOneEval({
				baseUrl: env(ctx, "EVAL_SYSTEMONE_URL"),
				...(model !== undefined && model !== "" ? { model } : {}),
				...(ctx.fetchImpl !== undefined ? { fetchImpl: ctx.fetchImpl } : {}),
			});
		}
		default:
			return unknownAdapter("eval", key);
	}
};

/** capability id → layer factory. `store`/`report` are intentionally
 * absent: persistence is always the local sqlite/jsonl pair wired by
 * `storeReportLayers` — see the module header. */
export const capabilityLayer = (ctx: WireContext, capability: string, adapterKey: string) => {
	switch (capability) {
		case "tts":
			return ttsLayer(ctx, adapterKey);
		case "asr":
			return asrLayer(ctx, adapterKey);
		case "llm":
			return llmLayer(ctx, adapterKey);
		case "eval":
			return evalLayer(ctx, adapterKey);
		default:
			return unknownAdapter(capability, adapterKey);
	}
};

/** The persistent dataset pair — sqlite manifest + blobs under
 * `<workdir>`, JSONL run records + markdown under
 * `<workdir>/reports/eval.jsonl`. */
export const storeReportLayers = (workdir: string) => ({
	store: makeLocalStoreLayer(workdir),
	report: makeLocalReportLayer(path.join(workdir, "reports", "eval.jsonl")),
});

/** One capability's layer from the resolved adapter map. Throws
 * (config error) on undeclared/unimplemented adapters — the caller
 * lets it propagate to the CLI's exit-1 path. */
export const modelLayer = (
	ctx: WireContext,
	adapters: Readonly<Record<string, string>>,
	capability: string,
): ReturnType<typeof capabilityLayer> => {
	const key = adapters[capability];
	if (key === undefined) {
		throw new Error(
			`capability "${capability}" has no adapter under profile "${ctx.profile}" — resolve the suite first`,
		);
	}
	return capabilityLayer(ctx, capability, key);
};

/** The model-port layers a command needs — one `modelLayer` per
 * capability (kept as an array for tests/introspection; commands
 * merge the singular layers because `Layer.mergeAll` wants a
 * non-empty tuple at the type level). */
export const modelLayers = (
	ctx: WireContext,
	adapters: Readonly<Record<string, string>>,
	needs: readonly string[],
): ReturnType<typeof capabilityLayer>[] => needs.map((cap) => modelLayer(ctx, adapters, cap));
