import { describe, expect, it } from "vitest";

import { STUB_CALL, StubBotProvider } from "./index.ts";

describe("StubBotProvider", () => {
	it("joins a call and returns a session", async () => {
		const p = new StubBotProvider();
		const s = await p.join("https://meet.example/x", "https://api.example/hook");
		expect(s.provider).toBe("stub");
		expect(s.botId).toMatch(/^stub-/);
	});
});

describe("STUB_CALL", () => {
	it("is a diarized transcript", () => {
		expect(STUB_CALL.length).toBeGreaterThan(0);
		expect(STUB_CALL[0]).toHaveProperty("speaker");
		expect(STUB_CALL[0]).toHaveProperty("text");
		expect(STUB_CALL[0]).toHaveProperty("delayMs");
	});
});
