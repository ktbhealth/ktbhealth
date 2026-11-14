import { describe, expect, it } from "vitest";

import { ContributionRegistry } from "@ktb/eval-core";
import { TtsPort } from "@ktb/eval-consult/ports";

import { plugins } from "./index.ts";
import { ttsContributions } from "./index.ts";

describe("transcription.tts", () => {
	it("declares the tts capability and synthesize stage against TtsPort", () => {
		const registry = new ContributionRegistry();
		for (const c of ttsContributions) registry.register(c);

		const capability = registry.get("eval.capability", "tts");
		expect(capability.meta?.port).toBe(TtsPort.key);
		expect(capability.meta?.adapters).toEqual({
			stub: "@ktb/eval-adapter-stub",
			"edge-tts": "@ktb/eval-adapter-local",
		});
		expect(registry.get("eval.stage", "synthesize").meta?.port).toBe(TtsPort.key);
	});

	it("exposes a single plugin manifest carrying its contributions", () => {
		expect(plugins.map((p) => p.id)).toEqual(["transcription.tts"]);
		expect(plugins[0]?.contributions).toBe(ttsContributions);
	});
});
