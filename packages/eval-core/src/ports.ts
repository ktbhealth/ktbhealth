import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { EvalAnswer, EvalQuestion, RunRecord } from "./schema.ts";

/**
 * Eval-core ports — the GENERIC hexagonal boundary every suite shares:
 * the shared failure type, the ACP task envelope, the typed decision
 * port, and the run-record sink. Domain ports (TTS, ASR, dataset
 * store) are contributed by domain packs/adapters on top of these.
 * No platform APIs, no provider literals.
 */

/** Single shared failure type — the port name identifies which
 * adapter failed; `cause` chains for diagnostics. */
export class PortError extends Data.TaggedError("PortError")<{
	readonly port: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/** ACP task envelope — the unit of delegated generation. EVERY
 * generative call goes through this shape (no raw-string shortcuts):
 * the envelope carries identity, output contract, and cost bounds so
 * sessions stay traceable and budgetable. */
export interface TaskEnvelope {
	readonly taskId: string;
	readonly role: "generator" | "corrector";
	readonly input: string;
	/** Declared output contract — ACP sessions validate against it
	 * (e.g. "EditList" for correct). */
	readonly outputSchema: string;
	readonly seed?: number;
	readonly modelHint?: string;
}

/** Structured decision port (Jev — System One typed questions).
 * NOT a generative port: answers are bounded typed values with
 * calibrated probabilities. */
export class EvalPort extends Context.Service<
	EvalPort,
	{
		/** Whether `state` may leave the perimeter (remote decision
		 * service vs in-process). Informational for the domain PHI
		 * policy — judge state is scrubbed upstream — declared so the
		 * capability is explicit like the other ports. */
		readonly egress?: boolean;
		readonly judge: (input: {
			readonly state: unknown;
			readonly questions: readonly EvalQuestion[];
		}) => Effect.Effect<{ answers: readonly EvalAnswer[]; record: RunRecord }, PortError>;
	}
>()("@ktb/eval-core/EvalPort") {}

/** Run-record sink + report rendering. */
export class ReportPort extends Context.Service<
	ReportPort,
	{
		readonly append: (record: RunRecord) => Effect.Effect<void, PortError>;
		/** Render a run's report — markdown table via `renderRunMarkdown`
		 * (the shape is part of the contract, not adapter-defined). */
		readonly render: (runId: string) => Effect.Effect<string, PortError>;
	}
>()("@ktb/eval-core/ReportPort") {}
