import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	startFetch: vi.fn(),
	handleAudioQueueBatch: vi.fn(),
	flushTelemetry: vi.fn(),
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
vi.mock("#/lib/platform.ts", () => ({
	flushTelemetry: mocks.flushTelemetry,
}));

import entry, { createServerEntry } from "./server.ts";

describe("worker entry", () => {
	it("exposes the start fetch pipeline next to the queue consumer", () => {
		expect(typeof entry.fetch).toBe("function");
		expect(typeof entry.queue).toBe("function");
	});

	it("re-exports the typed createServerEntry binding", () => {
		const e = { fetch: mocks.startFetch };
		expect(createServerEntry(e as never)).toBe(e);
	});

	it("delegates fetch to the start pipeline and schedules a telemetry flush", async () => {
		const request = new Request("https://ktb.test/");
		const response = new Response("ok");
		mocks.startFetch.mockReturnValue(response);
		const waitUntil = vi.fn();
		// The worker entry signature is (request, env, ctx); the public
		// RequestHandler type only exposes the request argument.
		const result = (entry.fetch as (req: Request, env: unknown, ctx: unknown) => Response)(
			request,
			{},
			{ waitUntil },
		);
		expect(result).toBe(response);
		expect(mocks.startFetch).toHaveBeenCalledWith(request);
		expect(waitUntil).toHaveBeenCalledTimes(1);
		await waitUntil.mock.calls[0]?.[0];
		expect(mocks.flushTelemetry).toHaveBeenCalled();
	});

	it("hands queue batches to the audio job handler and flushes telemetry", async () => {
		const messages = [{ id: "m1" }, { id: "m2" }];
		mocks.handleAudioQueueBatch.mockResolvedValue("handled");
		const waitUntil = vi.fn();
		await entry.queue({ messages } as never, {}, { waitUntil } as never);
		expect(mocks.handleAudioQueueBatch).toHaveBeenCalledWith(messages);
		expect(waitUntil).toHaveBeenCalledTimes(1);
		await waitUntil.mock.calls[0]?.[0];
		expect(mocks.flushTelemetry).toHaveBeenCalled();
	});
});

describe("worker entry failure path", () => {
	it("still schedules a telemetry flush when fetch rejects", async () => {
		mocks.startFetch.mockRejectedValueOnce(new Error("boom"));
		const waitUntil = vi.fn();
		const result = (entry.fetch as (req: Request, env: unknown, ctx: unknown) => Promise<Response>)(
			new Request("https://ktb.test/"),
			{},
			{ waitUntil },
		);
		await expect(result).rejects.toThrow("boom");
		expect(waitUntil).toHaveBeenCalledTimes(1);
		await waitUntil.mock.calls[0]?.[0];
		expect(mocks.flushTelemetry).toHaveBeenCalled();
	});
});
