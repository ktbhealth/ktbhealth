import { describe, expect, it } from "vitest";

import { ContributionRegistry } from "@ktb/eval-core";
import { AsrPort } from "@ktb/eval-consult/ports";

import { asrContributions, plugins } from "./index.ts";

describe("transcription.asr", () => {
	it("declares the asr capability and transcribe stage against AsrPort", () => {
		const registry = new ContributionRegistry();
		for (const c of asrContributions) registry.register(c);

		const capability = registry.get("eval.capability", "asr");
		expect(capability.meta?.port).toBe(AsrPort.key);
		expect(capability.meta?.adapters).toEqual({
			stub: "@ktb/eval-adapter-stub",
			"faster-whisper": "@ktb/eval-adapter-local",
			"workers-ai": "@ktb/eval-adapter-cloud",
		});
		expect(registry.get("eval.stage", "transcribe").meta?.port).toBe(AsrPort.key);
	});

	it("exposes a single plugin manifest carrying its contributions", () => {
		expect(plugins.map((p) => p.id)).toEqual(["transcription.asr"]);
		expect(plugins[0]?.contributions).toBe(asrContributions);
	});
});
