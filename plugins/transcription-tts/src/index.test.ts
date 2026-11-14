import { describe, expect, it } from "vitest";

import { ContributionRegistry } from "@ktb/eval-core";
import { TtsPort } from "@ktb/eval-consult/ports";

import { plugins } from "./index.ts";
import { ttsContributions } from "./index.ts";
import { plugins as clientPlugins } from "./client.ts";

describe("transcription.tts", () => {
	it("declares the tts capability and synthesize stage against TtsPort", () => {
		const registry = new ContributionRegistry();
		for (const c of ttsContributions) registry.register(c);

		const capability = registry.get("capability", "tts");
		expect(capability.meta?.port).toBe(TtsPort.key);
		expect(capability.meta?.adapters).toEqual({
			stub: "@ktb/eval-dataset-stub",
			"edge-tts": "@ktb/eval-dataset-local",
		});
		expect(registry.get("stage", "synthesize").meta?.port).toBe(TtsPort.key);
	});

	it("exposes a single plugin manifest mirrored on the client", () => {
		expect(plugins.map((p) => p.id)).toEqual(["transcription.tts"]);
		expect(clientPlugins.map((p) => p.id)).toEqual(plugins.map((p) => p.id));
	});
});
