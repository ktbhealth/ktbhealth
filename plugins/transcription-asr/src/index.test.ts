import { describe, expect, it } from "vitest";

import { ContributionRegistry } from "@ktb/eval-core";
import { AsrPort } from "@ktb/eval-consult/ports";

import { asrContributions, plugins } from "./index.ts";
import { plugins as clientPlugins } from "./client.ts";

describe("transcription.asr", () => {
	it("declares the asr capability and transcribe stage against AsrPort", () => {
		const registry = new ContributionRegistry();
		for (const c of asrContributions) registry.register(c);

		const capability = registry.get("capability", "asr");
		expect(capability.meta?.port).toBe(AsrPort.key);
		expect(capability.meta?.adapters).toEqual({
			stub: "@ktb/eval-dataset-stub",
			"faster-whisper": "@ktb/eval-dataset-local",
			"workers-ai": "@ktb/eval-dataset-cloud",
		});
		expect(registry.get("stage", "transcribe").meta?.port).toBe(AsrPort.key);
	});

	it("exposes a single plugin manifest mirrored on the client", () => {
		expect(plugins.map((p) => p.id)).toEqual(["transcription.asr"]);
		expect(clientPlugins.map((p) => p.id)).toEqual(plugins.map((p) => p.id));
	});
});
