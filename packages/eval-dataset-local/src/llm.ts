/**
 * llm.ts — LlmPort over an ACP session (T-104).
 *
 * The adapter serializes `TaskEnvelope`s to the frozen wire format and
 * validates every response against the envelope's declared
 * `outputSchema` via the validator registry — a misbehaving agent
 * produces typed PortErrors, never silent garbage.
 *
 * `transport` is the ONLY edge: inject the JSON-RPC send (stdio,
 * socket, in-process Devin ACP session). Session id is fixed per
 * layer — multi-session routing is a caller concern.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { AcpRequest, RunRecord, TaskEnvelope } from "@ktb/eval-dataset";
import { decodeTaskResult, encodeTask, LlmPort, PortError } from "@ktb/eval-dataset";
import type { EditList } from "@ktb/eval-dataset";

export type AcpTransport = (request: AcpRequest) => Effect.Effect<unknown, PortError>;

export interface AcpLlmOptions {
	readonly transport: AcpTransport;
	readonly sessionId?: string;
}

const call = (
	opts: AcpLlmOptions,
	envelope: TaskEnvelope,
	stage: string,
): Effect.Effect<{ payload: unknown; record: RunRecord }, PortError> => {
	const started = Date.now();
	return opts.transport(encodeTask(envelope, opts.sessionId)).pipe(
		Effect.flatMap((response) =>
			Effect.try({
				try: () => decodeTaskResult({ response, envelope }),
				// decodeTaskResult only throws PortError by construction
				catch: (e) => e as PortError,
			}),
		),
		Effect.map((payload) => ({
			payload,
			record: {
				runId: opts.sessionId ?? "acp",
				taskId: envelope.taskId,
				stage,
				engine: "acp",
				model: envelope.modelHint,
				inputHash: `${envelope.taskId}:${envelope.seed ?? 0}`,
				seed: envelope.seed,
				startedAt: started,
				latencyMs: Date.now() - started,
			},
		})),
	);
};

export const makeAcpLlm = (opts: AcpLlmOptions): Layer.Layer<LlmPort> =>
	Layer.succeed(
		LlmPort,
		LlmPort.of({
			generate: (envelope) =>
				call(opts, envelope, "generate").pipe(
					Effect.map(({ payload, record }) => ({ text: payload as string, record })),
				),
			correct: (envelope) =>
				call(opts, envelope, "correct").pipe(
					Effect.map(({ payload, record }) => ({ edits: payload as EditList, record })),
				),
		}),
	);
