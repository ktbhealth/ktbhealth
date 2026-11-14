import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineSuite } from "@ktb/eval-core";
import { DatasetStorePort, type SampleResult } from "@ktb/eval-consultation";

import { inputFieldOf, inputLabel, resolveSuiteInputs, type ResolvedSuiteInput } from "./inputs.ts";

let dir = "";

const SUITE = (id: string, extra = "") =>
	`export const suite = ${JSON.stringify({
		id,
		domain: "eval.consult",
		dataset: { id: "ds", version: "v1" },
		stages: ["transcribe"],
		caps: {},
		metrics: [],
		gates: [],
		schemaVersion: 1,
	})}${extra};`;

const result = (over: Partial<SampleResult>): SampleResult => ({
	runId: "run-a",
	sampleId: "s1",
	datasetVersion: "ds-v1",
	asrText: "asr text",
	editVerdicts: [],
	confSegments: [],
	createdAt: 1,
	...over,
});

/** In-memory DatasetStorePort returning canned results. */
const storeWith = (rows: readonly SampleResult[]) =>
	Layer.succeed(
		DatasetStorePort,
		DatasetStorePort.of({
			putSample: () => Effect.void,
			getSample: () => Effect.succeed(null),
			listSamples: () => Effect.succeed([]),
			putBlob: () => Effect.void,
			putBlobMeta: () => Effect.void,
			getBlob: () => Effect.succeed(null),
			getBlobMeta: () => Effect.succeed(null),
			putResult: () => Effect.void,
			listResults: (filter) =>
				Effect.succeed(
					rows.filter(
						(r) =>
							(filter?.runId === undefined || r.runId === filter.runId) &&
							(filter?.sampleId === undefined || r.sampleId === filter.sampleId),
					),
				),
		}),
	);

const runResolve = (
	manifest: ReturnType<typeof defineSuite>,
	rows: readonly SampleResult[],
): Promise<readonly ResolvedSuiteInput[]> =>
	Effect.runPromise(resolveSuiteInputs(dir, manifest).pipe(Effect.provide(storeWith(rows))));

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-inputs-"));
	fs.writeFileSync(path.join(dir, "src.suite.ts"), SUITE("src"));
	fs.writeFileSync(path.join(dir, "dst.suite.ts"), SUITE("dst"));
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("inputLabel / inputFieldOf", () => {
	it("labels carry declared qualifiers only", () => {
		expect(inputLabel({ suite: "s" })).toBe("s");
		expect(inputLabel({ suite: "s", stage: "transcribe" })).toBe("s#transcribe");
		expect(inputLabel({ suite: "s", stage: "cleanup", field: "correctedText" })).toBe(
			"s#cleanup.correctedText",
		);
		expect(inputLabel({ suite: "s", field: "asrText" })).toBe("s.asrText");
	});

	it("field defaults from stage, explicit field wins", () => {
		expect(inputFieldOf({ suite: "s" })).toBeUndefined();
		expect(inputFieldOf({ suite: "s", stage: "transcribe" })).toBe("asrText");
		expect(inputFieldOf({ suite: "s", stage: "cleanup" })).toBe("correctedText");
		expect(inputFieldOf({ suite: "s", stage: "judge" })).toBeUndefined();
		expect(inputFieldOf({ suite: "s", stage: "bogus" })).toBeUndefined();
		expect(inputFieldOf({ suite: "s", field: "edits" })).toBe("edits");
		expect(inputFieldOf({ suite: "s", stage: "transcribe", field: "x" })).toBe("x");
	});
});

describe("resolveSuiteInputs", () => {
	const manifest = (inputs?: unknown) =>
		defineSuite({
			id: "dst",
			domain: "eval.consult",
			dataset: { id: "ds", version: "v1" },
			stages: ["transcribe"],
			caps: {},
			metrics: [],
			gates: [],
			schemaVersion: 1,
			...(inputs !== undefined ? { inputs } : {}),
		});

	it("returns [] for input-less manifests without touching the store", async () => {
		const out = await Effect.runPromise(
			resolveSuiteInputs(dir, manifest()).pipe(
				Effect.provide(
					Layer.succeed(
						DatasetStorePort,
						DatasetStorePort.of({
							putSample: () => Effect.void,
							getSample: () => Effect.succeed(null),
							listSamples: () => Effect.succeed([]),
							putBlob: () => Effect.void,
							putBlobMeta: () => Effect.void,
							getBlob: () => Effect.succeed(null),
							getBlobMeta: () => Effect.succeed(null),
							putResult: () => Effect.void,
							listResults: () => Effect.die("store must not be read"),
						}),
					),
				),
			),
		);
		expect(out).toEqual([]);
	});

	it("resolves the newest run for the source suite's dataset pin", async () => {
		const rows = [
			result({ runId: "run-old", createdAt: 5 }),
			// Same run, older row — the latest-createdAt fold keeps 8.
			result({ runId: "run-old", sampleId: "s0", createdAt: 3 }),
			result({ runId: "run-old", sampleId: "s-1", createdAt: 8 }),
			result({ runId: "run-new", createdAt: 9, sampleId: "s2" }),
			// Other dataset versions are out of scope.
			result({ runId: "run-x", datasetVersion: "ds-v9", createdAt: 99 }),
		];
		const out = await runResolve(manifest([{ suite: "src" }]), rows);
		expect(out).toHaveLength(1);
		expect(out[0]!.runId).toBe("run-new");
		expect(out[0]!.suiteId).toBe("src");
		expect(out[0]!.datasetVersion).toBe("ds-v1");
		expect(out[0]!.rows.map((r) => r.sampleId)).toEqual(["s2"]);
	});

	it("honours an explicit runId pin", async () => {
		const rows = [result({ runId: "run-a" }), result({ runId: "run-b", createdAt: 5 })];
		const out = await runResolve(manifest([{ suite: "src", runId: "run-a" }]), rows);
		expect(out[0]!.runId).toBe("run-a");
		expect(out[0]!.rows).toHaveLength(1);
	});

	it("honours an explicit datasetVersion override", async () => {
		const rows = [
			result({ runId: "run-a", datasetVersion: "ds-v9" }),
			result({ runId: "run-b", datasetVersion: "ds-v1" }),
		];
		const out = await runResolve(manifest([{ suite: "src", datasetVersion: "ds-v9" }]), rows);
		expect(out[0]!.datasetVersion).toBe("ds-v9");
		expect(out[0]!.runId).toBe("run-a");
	});

	it("breaks newest-run ties deterministically by runId", async () => {
		// Mixed first-seen order exercises both comparator directions;
		// the winner is the lexicographically largest runId among
		// equal createdAt.
		const rows = [
			result({ runId: "run-b", createdAt: 5 }),
			result({ runId: "run-a", createdAt: 5 }),
			result({ runId: "run-c", createdAt: 5 }),
		];
		const out = await runResolve(manifest([{ suite: "src" }]), rows);
		expect(out[0]!.runId).toBe("run-c");
	});

	it("propagates suite-tree load failures", async () => {
		const err = await Effect.runPromise(
			resolveSuiteInputs(path.join(dir, "does-not-exist"), manifest([{ suite: "src" }])).pipe(
				Effect.provide(storeWith([])),
			),
		).then(
			() => null,
			(e: unknown) => e,
		);
		expect(String(err)).toContain("suite directory not found");
	});

	it("fails when the source suite manifest does not exist", async () => {
		const err = await runResolve(manifest([{ suite: "ghost" }]), []).then(
			() => null,
			(e: unknown) => e,
		);
		expect(String(err)).toContain('no suite manifest "ghost"');
	});

	it("fails when no persisted results match the ref", async () => {
		const err = await runResolve(manifest([{ suite: "src" }]), []).then(
			() => null,
			(e: unknown) => e,
		);
		expect(String(err)).toContain("resolved no results");
		expect(String(err)).toContain("run the source suite first");
	});

	it("fails when an explicit runId has no rows in the dataset version", async () => {
		const rows = [result({ runId: "run-a", datasetVersion: "other-v1" })];
		const err = await runResolve(manifest([{ suite: "src", runId: "run-a" }]), rows).then(
			() => null,
			(e: unknown) => e,
		);
		expect(String(err)).toContain("(run run-a)");
	});

	it("resolves multiple inputs independently", async () => {
		const rows = [result({ runId: "run-a" })];
		const out = await runResolve(
			manifest([{ suite: "src" }, { suite: "dst", field: "correctedText" }]),
			rows,
		);
		expect(out.map((b) => b.suiteId)).toEqual(["src", "dst"]);
		expect(out[1]!.label).toBe("dst.correctedText");
	});
});
