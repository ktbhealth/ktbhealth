import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";

import {
	telemetryAnnotations,
	telemetryContext,
	TelemetryContext,
	withTelemetryContext,
} from "./context.ts";

describe("TelemetryContext", () => {
	it("defaults to an empty context", async () => {
		const ctx = await Effect.runPromise(telemetryContext);
		expect(ctx).toEqual({});
	});
});

describe("withTelemetryContext", () => {
	it("merges defined fields and preserves the rest", async () => {
		const result = await Effect.runPromise(
			withTelemetryContext({ requestId: "r1", userId: "u1" }, telemetryContext),
		);
		expect(result).toEqual({ requestId: "r1", userId: "u1" });

		const nested = await Effect.runPromise(
			withTelemetryContext(
				{ requestId: "r1" },
				withTelemetryContext({ tenantId: 7 }, telemetryContext),
			),
		);
		expect(nested).toEqual({ requestId: "r1", tenantId: 7 });
	});

	it("leaves fields untouched when patch omits them", async () => {
		const ctx = await Effect.runPromise(
			withTelemetryContext(
				{ requestId: "r1" },
				withTelemetryContext({ route: "/x" }, telemetryContext),
			),
		);
		expect(ctx.requestId).toBe("r1");
		expect(ctx.route).toBe("/x");
	});

	it("clears tenantId on explicit null", async () => {
		const ctx = await Effect.runPromise(
			withTelemetryContext(
				{ tenantId: 3 },
				withTelemetryContext({ tenantId: null }, telemetryContext),
			),
		);
		expect(ctx.tenantId).toBeNull();
	});

	it("does not leak the patch outside the wrapped effect", async () => {
		await Effect.runPromise(withTelemetryContext({ requestId: "r1" }, Effect.void));
		const after = await Effect.runPromise(telemetryContext);
		expect(after.requestId).toBeUndefined();
	});
});

describe("telemetryAnnotations", () => {
	it("projects only defined, log-safe fields", () => {
		expect(telemetryAnnotations({})).toEqual({});
		expect(
			telemetryAnnotations({
				requestId: "r1",
				userId: "u1",
				tenantId: 4,
				route: "/patients",
				traceparent: "00-abc-def-01",
			}),
		).toEqual({
			"telemetry.request_id": "r1",
			"telemetry.user_id": "u1",
			"telemetry.tenant_id": 4,
			"telemetry.route": "/patients",
		});
	});

	it("omits null tenantId", () => {
		expect(telemetryAnnotations({ tenantId: null })).toEqual({});
	});
});

describe("TelemetryContext reference", () => {
	it("can be provided directly via provideService", async () => {
		const ctx = await Effect.runPromise(
			telemetryContext.pipe(Effect.provideService(TelemetryContext, { requestId: "direct" })),
		);
		expect(ctx.requestId).toBe("direct");
	});
});

describe("externalSpanFromTraceparent", () => {
	it("builds an external span from a valid sampled traceparent", async () => {
		const { externalSpanFromTraceparent } = await import("./context.ts");
		const span = externalSpanFromTraceparent(
			"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
		);
		expect(span).toBeDefined();
		expect(span?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
		expect(span?.spanId).toBe("b7ad6b7169203331");
		expect(span?.sampled).toBe(true);
	});

	it("marks unsampled when the flags byte lacks the sampled bit", async () => {
		const { externalSpanFromTraceparent } = await import("./context.ts");
		const span = externalSpanFromTraceparent(
			"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
		);
		expect(span?.sampled).toBe(false);
	});

	it("returns undefined for missing or malformed values", async () => {
		const { externalSpanFromTraceparent } = await import("./context.ts");
		expect(externalSpanFromTraceparent(undefined)).toBeUndefined();
		expect(externalSpanFromTraceparent("not-a-traceparent")).toBeUndefined();
		expect(externalSpanFromTraceparent("00-short-01")).toBeUndefined();
	});
});

describe("newRequestId", () => {
	it("generates ids via crypto.randomUUID when available", async () => {
		const { newRequestId } = await import("./context.ts");
		const id = newRequestId();
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("falls back to a random id when crypto.randomUUID is unavailable", async () => {
		const { vi } = await import("vitest");
		vi.stubGlobal("crypto", {});
		try {
			const { newRequestId } = await import("./context.ts");
			const id = newRequestId();
			expect(id).toMatch(/^req-[a-z0-9]+-[a-z0-9]+$/);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("withTelemetryContext traceparent", () => {
	it("sets traceparent when provided", async () => {
		const ctx = await Effect.runPromise(
			withTelemetryContext(
				{ traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" },
				telemetryContext,
			),
		);
		expect(ctx.traceparent).toBe("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
	});
});
