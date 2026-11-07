import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecallBotProvider, selectBotProvider } from "./index.ts";

describe("selectBotProvider", () => {
	const original = process.env.RECALL_API_KEY;

	afterEach(() => {
		if (original !== undefined) process.env.RECALL_API_KEY = original;
		else delete process.env.RECALL_API_KEY;
	});

	it("returns StubBotProvider when RECALL_API_KEY is unset", () => {
		delete process.env.RECALL_API_KEY;
		const provider = selectBotProvider();
		expect(provider.name).toBe("stub");
	});

	it("returns RecallBotProvider when RECALL_API_KEY is present", () => {
		process.env.RECALL_API_KEY = "test-key";
		const provider = selectBotProvider();
		expect(provider.name).toBe("recall");
	});
});

describe("RecallBotProvider", () => {
	const original = process.env.RECALL_API_KEY;

	beforeEach(() => {
		process.env.RECALL_API_KEY = "test-key";
	});

	afterEach(() => {
		if (original !== undefined) process.env.RECALL_API_KEY = original;
		else delete process.env.RECALL_API_KEY;
		vi.restoreAllMocks();
	});

	it("throws if RECALL_API_KEY is missing", async () => {
		delete process.env.RECALL_API_KEY;
		const provider = new RecallBotProvider();
		await expect(provider.join("https://meet.example/x", "https://hook.example/")).rejects.toThrow(
			"RECALL_API_KEY not set",
		);
	});

	it("posts to recall API and returns botId", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ id: "bot-123" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new RecallBotProvider();
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
		const provider = new RecallBotProvider();
		await expect(provider.join("https://meet.example/x", "https://hook.example/")).rejects.toThrow(
			"recall api: 401",
		);
	});
});
