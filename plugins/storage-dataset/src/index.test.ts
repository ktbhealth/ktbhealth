import { describe, expect, it } from "vitest";

import { ContributionRegistry, ReportPort } from "@ktb/eval-core";
import { DatasetStorePort } from "@ktb/eval-consult/ports";

import { plugins, storageDatasetContributions } from "./index.ts";

describe("storage.dataset", () => {
	it("declares the store and report capabilities", () => {
		const registry = new ContributionRegistry();
		for (const c of storageDatasetContributions) registry.register(c);

		expect(registry.get("eval.capability", "store").meta?.port).toBe(DatasetStorePort.key);
		expect(registry.get("eval.capability", "store").meta?.adapters).toEqual({
			stub: "@ktb/eval-adapter-stub",
			"sqlite-fs": "@ktb/eval-adapter-local",
			r2: "@ktb/eval-adapter-cloud",
		});
		expect(registry.get("eval.capability", "report").meta?.port).toBe(ReportPort.key);
		expect(registry.get("eval.capability", "report").meta?.adapters).toEqual({
			stub: "@ktb/eval-adapter-stub",
			jsonl: "@ktb/eval-adapter-local",
		});
	});

	it("exposes a single plugin manifest carrying its contributions", () => {
		expect(plugins.map((p) => p.id)).toEqual(["storage.dataset"]);
		expect(plugins[0]?.contributions).toBe(storageDatasetContributions);
	});
});
