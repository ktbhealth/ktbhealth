import { describe, expect, it } from "vitest";

import { whisperBackend, whisperCandidate } from "./index.ts";

describe("whisperCandidate", () => {
	it("is unsupported without browser media APIs and creates whisperBackend", () => {
		expect(whisperCandidate.id).toBe("whisper");
		expect(whisperCandidate.supported()).toBe(false);
		expect(whisperCandidate.create()).toBe(whisperBackend);
	});
});
