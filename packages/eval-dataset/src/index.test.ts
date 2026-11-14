import { describe, expect, it } from "vitest";

import * as Dataset from "./index.ts";
import * as DatasetPorts from "./ports.ts";
import * as DatasetSchema from "./schema.ts";

// Compat-shim smoke test (P-074 phase 2a): the domain pack moved to
// @ktb/eval-consult and the generic framework to @ktb/eval-core —
// `@ktb/eval-dataset` must keep re-exporting both surfaces so adapter
// packages keep compiling until they are rewired.
describe("@ktb/eval-dataset compat surface", () => {
	it("re-exports the generic framework", () => {
		expect(typeof Dataset.runBatch).toBe("function");
		expect(typeof Dataset.defineSuite).toBe("function");
	});

	it("re-exports the consult domain pack", () => {
		expect(typeof Dataset.processSample).toBe("function");
		expect(typeof Dataset.generateDataset).toBe("function");
		expect(typeof Dataset.gateRun).toBe("function");
		expect(typeof Dataset.decideAutoAccept).toBe("function");
		expect(Dataset.ptBR).toBeDefined();
	});

	it("exposes the domain plugin manifest", () => {
		expect(Dataset.plugins.map((p) => p.id)).toContain("eval.consult");
	});

	it("keeps the ./schema and ./ports subpaths populated", () => {
		expect(DatasetSchema.Sample).toBeDefined();
		expect(DatasetSchema.SampleResult).toBeDefined();
		expect(DatasetPorts.TtsPort).toBeDefined();
		expect(DatasetPorts.AsrPort).toBeDefined();
		expect(DatasetPorts.DatasetStorePort).toBeDefined();
		expect(DatasetPorts.EvalPort).toBeDefined();
	});
});
