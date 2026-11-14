import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type {
	CalibrationReport,
	DatasetManifest,
	EvalAnswer,
	EvalQuestion,
	Experiment,
	RunRecord,
} from "./schema.ts";

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

/** Framework-level artifact store (P-076) — the market-parity half of
 * persistence, sibling to the domain packs' DatasetStorePort:
 *
 *   - experiments: one Experiment per `eval run`/`eval generate`
 *   - dataset manifests: the registry `eval generate` writes and
 *     `eval list --strict` validates suite dataset pins against
 *   - calibration reports: `eval calibrate` judge-vs-gold output
 *
 * These records are cross-suite (a dataset manifest is shared
 * registry state, not one suite's rows), which is why they live on
 * their own port rather than the domain store. All three collections
 * are keyed by content id and upsert on rewrite — EXCEPT
 * putDatasetManifest, which enforces registry semantics: re-registering
 * the same id+version with a DIFFERENT contentHash is a PortError
 * (regenerate under a new version instead of silently drifting the
 * pin); the same contentHash is an idempotent no-op. */
export class EvalStorePort extends Context.Service<
	EvalStorePort,
	{
		readonly putExperiment: (experiment: Experiment) => Effect.Effect<void, PortError>;
		readonly getExperiment: (id: string) => Effect.Effect<Experiment | null, PortError>;
		readonly listExperiments: (filter?: {
			readonly suiteId?: string;
		}) => Effect.Effect<readonly Experiment[], PortError>;

		readonly putDatasetManifest: (manifest: DatasetManifest) => Effect.Effect<void, PortError>;
		readonly getDatasetManifest: (
			id: string,
			version: string,
		) => Effect.Effect<DatasetManifest | null, PortError>;
		readonly listDatasetManifests: () => Effect.Effect<readonly DatasetManifest[], PortError>;

		readonly putCalibrationReport: (report: CalibrationReport) => Effect.Effect<void, PortError>;
		readonly listCalibrationReports: (filter?: {
			readonly suiteId?: string;
			runId?: string;
		}) => Effect.Effect<readonly CalibrationReport[], PortError>;
	}
>()("@ktb/eval-core/EvalStorePort") {}
