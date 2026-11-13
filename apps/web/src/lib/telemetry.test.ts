import { describe, expect, it, vi } from "vitest";

const headers = { current: null as Headers | null };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => {
		if (headers.current === null) throw new Error("no request context");
		return headers.current;
	},
}));

import { requestTelemetryContext } from "./telemetry.ts";

describe("requestTelemetryContext", () => {
	it("honors inbound x-request-id and traceparent", async () => {
		headers.current = new Headers({
			"x-request-id": "req-inbound",
			traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
		});
		const ctx = await requestTelemetryContext();
		expect(ctx).toEqual({
			requestId: "req-inbound",
			traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
		});
	});

	it("falls back to x-trace-id and generates ids/undefined traceparent", async () => {
		headers.current = new Headers({ "x-trace-id": "trace-legacy" });
		const ctx = await requestTelemetryContext();
		expect(ctx.requestId).toBe("trace-legacy");
		expect(ctx.traceparent).toBeUndefined();
	});

	it("generates a fresh request id outside a request context", async () => {
		headers.current = null;
		const ctx = await requestTelemetryContext();
		expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$|^req-/);
		expect(ctx.traceparent).toBeUndefined();
	});
});
