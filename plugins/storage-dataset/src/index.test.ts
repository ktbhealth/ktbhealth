import { describe, expect, it } from "vitest";

import { ContributionRegistry, ReportPort } from "@ktb/eval-core";
import { DatasetStorePort } from "@ktb/eval-consult/ports";

import { plugins, storageDatasetContributions } from "./index.ts";
import { plugins as clientPlugins } from "./client.ts";

describe("storage.dataset", () => {
	it("declares the store and report capabilities", () => {
		const registry = new ContributionRegistry();
		for (const c of storageDatasetContributions) registry.register(c);

		expect(registry.get("capability", "store").meta?.port).toBe(DatasetStorePort.key);
		expect(registry.get("capability", "store").meta?.adapters).toEqual({
			stub: "@ktb/eval-dataset-stub",
			"sqlite-fs": "@ktb/eval-dataset-local",
			r2: "@ktb/eval-dataset-cloud",
		});
		expect(registry.get("capability", "report").meta?.port).toBe(ReportPort.key);
		expect(registry.get("capability", "report").meta?.adapters).toEqual({
			stub: "@ktb/eval-dataset-stub",
			jsonl: "@ktb/eval-dataset-local",
		});
	});

	it("exposes a single plugin manifest mirrored on the client", () => {
		expect(plugins.map((p) => p.id)).toEqual(["storage.dataset"]);
		expect(clientPlugins.map((p) => p.id)).toEqual(plugins.map((p) => p.id));
	});
});
