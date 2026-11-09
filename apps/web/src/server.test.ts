import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startFetch: vi.fn(),
	handleAudioQueueBatch: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
	createStartHandler: vi.fn(() => mocks.startFetch),
	defaultStreamHandler: {},
	// Identity: the real one only binds the Register type.
	createServerEntry: (entry: unknown) => entry,
}));
vi.mock("#/lib/audio-jobs.ts", () => ({
	handleAudioQueueBatch: mocks.handleAudioQueueBatch,
}));

import entry, { createServerEntry } from "./server.ts";

describe("worker entry", () => {
	it("exposes the start fetch pipeline next to the queue consumer", () => {
		expect(entry.fetch).toBe(mocks.startFetch);
		expect(typeof entry.queue).toBe("function");
	});

	it("re-exports the typed createServerEntry binding", () => {
		const e = { fetch: mocks.startFetch };
		expect(createServerEntry(e as never)).toBe(e);
	});

	it("hands queue batches to the audio job handler", async () => {
		const messages = [{ id: "m1" }, { id: "m2" }];
		mocks.handleAudioQueueBatch.mockResolvedValue("handled");
		const result = await entry.queue({ messages } as never, {}, {} as never);
		expect(mocks.handleAudioQueueBatch).toHaveBeenCalledWith(messages);
		expect(result).toBe("handled");
	});
});
