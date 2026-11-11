import { afterEach, describe, expect, it, vi } from "vitest";

import { Bot } from "@ktb/bot";
import { RecallBotProvider, recallDriver } from "./index.ts";

describe("RecallBotProvider", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("posts to recall API and returns botId", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: "bot-123" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new RecallBotProvider("test-key");
		const session = await provider.join("https://meet.example/x", "https://hook.example/");
		expect(session).toEqual({ botId: "bot-123", provider: "recall" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.recall.ai/api/v1/bot",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ authorization: "Token test-key" }),
			}),
		);
	});

	it("throws on non-ok API response", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
		const provider = new RecallBotProvider("test-key");
		await expect(provider.join("https://meet.example/x", "https://hook.example/")).rejects.toThrow(
			"recall api: 401",
		);
	});
});

describe("recallDriver", () => {
	it("is eligible only when RECALL_API_KEY is bound", () => {
		expect(recallDriver.id).toBe("bot-recall");
		expect(recallDriver.port).toBe(Bot.key);
		expect(recallDriver.when?.({})).toBe(false);
		expect(recallDriver.when?.({ RECALL_API_KEY: "" })).toBe(false);
		expect(recallDriver.when?.({ RECALL_API_KEY: "k" })).toBe(true);
	});

	it("provides a recall-backed Bot layer", () => {
		expect(recallDriver.provides({ RECALL_API_KEY: "k" })).toBeDefined();
		// `when` gates eligibility, but `provides` still tolerates a missing
		// key (empty-string fallback) if invoked directly.
		expect(recallDriver.provides({})).toBeDefined();
	});
});
