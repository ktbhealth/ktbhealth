/**
 * eval-gate — opt-in CI gate over a finished eval run (M3).
 *
 *   bun packages/eval-dataset-local/scripts/eval-gate.ts \
 *     --workdir /tmp/eval-data [--enforce] [--stage corrected]
 *
 * Reads every persisted SampleResult and applies the auto-accept
 * policy (Wilson floor + WER cap + severity risk budget). Without
 * --enforce it always exits 0 — a report, not a gate. With --enforce
 * it exits 1 when any sample fails — wire that flag into CI only when
 * the cohort is big enough for the Wilson floor to be reachable.
 *
 * Defaults are jointly reachable by construction: at 100% observed
 * precision the Wilson floor is 1/(1+z²/n) (z=1.96 → z²≈3.84), so
 * target 0.90 needs n ≥ 35 segments — minN 40 clears it with margin.
 * (target 0.95 would need n ≥ 73; a smaller minN could never pass.)
 */
import * as Effect from "effect/Effect";

import { DatasetStorePort, decideAutoAccept, gateRun } from "@ktb/eval-dataset";

import { makeLocalStoreLayer } from "../src/index.ts";

const arg = (name: string, def: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : def;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const workdir = arg("workdir", "/tmp/eval-generate");
const policy = {
	stage: arg("stage", "corrected") as "asr" | "corrected",
	maxWer: Number(arg("max-wer", "0.05")),
	target: Number(arg("target", "0.90")),
	minN: Number(arg("min-n", "40")),
	maxRisk: Number(arg("max-risk", "0")),
};

const results = await Effect.runPromise(
	Effect.gen(function* () {
		const store = yield* DatasetStorePort;
		return yield* store.listResults();
	}).pipe(Effect.provide(makeLocalStoreLayer(workdir))),
);

if (results.length === 0) {
	console.log(`no results under ${workdir} — nothing to gate`);
	process.exit(0);
}

const verdicts = results.map((r) => ({ id: r.sampleId, decision: decideAutoAccept(r, policy) }));
const gate = gateRun(results, policy);

for (const { id, decision } of verdicts) {
	const mark = decision.accept ? "accept" : `REJECT — ${decision.reasons.join("; ")}`;
	console.log(`  ${id}: ${mark}`);
}
console.log(
	`\n${gate.accepted}/${results.length} accepted — run is ${gate.green ? "GREEN" : "RED"} (stage=${policy.stage}, wer≤${policy.maxWer}, floor≥${policy.target}@n≥${policy.minN}, risk≤${policy.maxRisk})`,
);

if (flag("enforce") && !gate.green) {
	process.exit(1);
}
