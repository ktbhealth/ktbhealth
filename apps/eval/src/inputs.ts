/**
 * inputs.ts — cross-suite composition resolution (P-077).
 *
 * A suite manifest's `inputs` refs name OTHER suites' persisted
 * artifacts. Resolution happens here, in the composition root, because
 * it bridges two domain-owned surfaces: the evals/ manifest tree
 * (suites.ts) and the domain DatasetStorePort's SampleResult rows
 * (@ktb/eval-consultation). eval-core owns only the manifest schema
 * and the Experiment.derivedFrom lineage field — it stays
 * domain-blind.
 *
 * Semantics (documented contract):
 *
 *   - `suite` must name a suite manifest in the same evals/ tree;
 *     `eval list` warns on misses, `eval run` fails hard — an
 *     unresolvable input can never be fabricated.
 *   - `datasetVersion` defaults to the SOURCE suite's own dataset
 *     pin (`<id>-<version>`); `runId` pins an exact prior run
 *     (Experiment id). With neither, the NEWEST run for that dataset
 *     version wins (max createdAt; runId breaks ties deterministically).
 *   - Resolved rows are always ALREADY-PERSISTED results — inputs can
 *     never read the in-flight run, so input cycles (A←B←A, or a
 *     suite consuming its own previous runs) degrade to "previous
 *     iteration" semantics rather than deadlocking. That is allowed
 *     on purpose: iterative refinement across runs is a legitimate
 *     composition.
 *   - `stage`+`field` select WHICH artifact: `field` is a
 *     SampleResult column; absent, it defaults from `stage`
 *     (transcribe→asrText, cleanup→correctedText — see
 *     FIELD_BY_STAGE). Today the consultation runner consumes only
 *     `asrText` (as `priorAsrText`); other resolved fields are
 *     validated, counted, and recorded as lineage but have no stage
 *     consumer yet.
 */

import * as Effect from "effect/Effect";

import type { EvalSuiteManifest, SuiteInput } from "@ktb/eval-core";
import { DatasetStorePort, type SampleResult } from "@ktb/eval-consultation";

import { datasetVersionOf } from "./shared.ts";
import { loadSuites } from "./suites.ts";

/** Human label for one input ref — `suite#stage.field` with only the
 * declared qualifiers. */
export const inputLabel = (input: SuiteInput): string => {
	let label = input.suite;
	if (input.stage !== undefined) label += `#${input.stage}`;
	if (input.field !== undefined) label += `.${input.field}`;
	return label;
};

/** stage → SampleResult column when `field` is not declared. Only
 * stages whose output is a persisted text column map here. */
const FIELD_BY_STAGE: Readonly<Record<string, string>> = {
	transcribe: "asrText",
	cleanup: "correctedText",
};

/** The SampleResult column an input ref selects — explicit `field`
 * wins, else the stage default, else undefined (whole-row ref: valid
 * manifest data, no current consumer). */
export const inputFieldOf = (input: SuiteInput): string | undefined =>
	input.field ?? (input.stage !== undefined ? FIELD_BY_STAGE[input.stage] : undefined);

/** One resolved input — the ref plus the exact artifact slice it
 * materialized to. `runId` is always concrete: either the declared
 * pin or the newest matching run. */
export interface ResolvedSuiteInput {
	readonly input: SuiteInput;
	readonly label: string;
	readonly suiteId: string;
	readonly datasetVersion: string;
	readonly runId: string;
	readonly rows: readonly SampleResult[];
}

/* v8 ignore next -- loadSuites rejects with Error; the String()
 * fallback only guards against exotic non-Error throws. */
const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

const newestRun = (
	rows: readonly SampleResult[],
): { runId: string; rows: readonly SampleResult[] } => {
	const byRun = new Map<string, { latest: number; rows: SampleResult[] }>();
	for (const r of rows) {
		const g = byRun.get(r.runId);
		if (g === undefined) {
			byRun.set(r.runId, { latest: r.createdAt, rows: [r] });
		} else {
			g.rows.push(r);
			if (r.createdAt > g.latest) g.latest = r.createdAt;
		}
	}
	// Newest by createdAt; runId descending breaks ties deterministically
	// (keys are unique, so the comparator never sees equal ids).
	const runId = [...byRun.keys()].sort((a, b) => {
		const la = byRun.get(a)!.latest;
		const lb = byRun.get(b)!.latest;
		return lb - la || (a < b ? 1 : -1);
	})[0]!;
	return { runId, rows: byRun.get(runId)!.rows };
};

/**
 * Resolve a manifest's `inputs` against the evals/ tree + the
 * DatasetStorePort. Returns [] for input-less manifests without
 * touching the store. Errors are plain `Error`s — the caller maps
 * them to its CLI error channel (manifest bugs and missing data are
 * both fatal to `eval run`; `eval list` does its own lighter check).
 */
export const resolveSuiteInputs = (
	dir: string,
	manifest: EvalSuiteManifest,
): Effect.Effect<readonly ResolvedSuiteInput[], Error, DatasetStorePort> =>
	Effect.gen(function* () {
		const inputs = manifest.inputs ?? [];
		if (inputs.length === 0) return [];
		const suites = yield* Effect.tryPromise({
			try: () => loadSuites(dir),
			catch: toError,
		});
		const store = yield* DatasetStorePort;
		const out: ResolvedSuiteInput[] = [];
		for (const input of inputs) {
			const label = inputLabel(input);
			const src = suites.find((s) => s.manifest.id === input.suite);
			if (src === undefined) {
				return yield* Effect.fail(
					new Error(
						`suite "${manifest.id}" input "${label}" — no suite manifest "${input.suite}" under ${dir}`,
					),
				);
			}
			const datasetVersion = input.datasetVersion ?? datasetVersionOf(src.manifest);
			const rows = yield* store.listResults(
				input.runId !== undefined ? { runId: input.runId } : undefined,
			);
			const scoped = rows.filter((r) => r.datasetVersion === datasetVersion);
			if (scoped.length === 0) {
				return yield* Effect.fail(
					new Error(
						`suite "${manifest.id}" input "${label}" resolved no results for dataset ` +
							`"${datasetVersion}"` +
							(input.runId !== undefined ? ` (run ${input.runId})` : "") +
							" — run the source suite first",
					),
				);
			}
			const picked =
				input.runId !== undefined ? { runId: input.runId, rows: scoped } : newestRun(scoped);
			out.push({
				input,
				label,
				suiteId: src.manifest.id,
				datasetVersion,
				runId: picked.runId,
				rows: picked.rows,
			});
		}
		return out;
	});
