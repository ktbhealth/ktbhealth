import { afterEach, describe, expect, it, vi } from "vitest";

import { accessLog, setAccessLogSink, type AccessLogFields } from "./access-log.ts";

const fields: AccessLogFields = {
	method: "GET",
	path: "/x",
	status: 200,
	handlerType: "router",
	durationMs: 3,
	requestId: "r1",
	traceId: "0af7651916cd43dd8448eb211c80319c",
};

afterEach(() => {
	setAccessLogSink(undefined);
	vi.restoreAllMocks();
});

describe("accessLog", () => {
	it("falls back to a flat console.info line when no sink is registered", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await accessLog(fields);
		expect(info).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(info.mock.calls[0]![0]))).toEqual({
			message: "http.access",
			level: "INFO",
			...fields,
		});
	});

	it("routes through the registered sink and skips console output", async () => {
		const sink = vi.fn().mockResolvedValue(undefined);
		setAccessLogSink(sink);
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await accessLog(fields);
		expect(sink).toHaveBeenCalledTimes(1);
		expect(sink.mock.calls[0]![0]).toEqual(fields);
		expect(info).not.toHaveBeenCalled();
	});

	it("strips undefined fields before calling the sink", async () => {
		const sink = vi.fn().mockResolvedValue(undefined);
		setAccessLogSink(sink);
		await accessLog({ ...fields, traceId: undefined });
		expect(sink.mock.calls[0]![0]).not.toHaveProperty("traceId");
		expect(sink.mock.calls[0]![0]).toMatchObject({ method: "GET", requestId: "r1" });
	});

	it("swallows async sink failures", async () => {
		setAccessLogSink(() => Promise.reject(new Error("boom")));
		await expect(accessLog(fields)).resolves.toBeUndefined();
	});

	it("swallows synchronous sink throws", async () => {
		setAccessLogSink(() => {
			throw new Error("boom");
		});
		await expect(accessLog(fields)).resolves.toBeUndefined();
	});
});
