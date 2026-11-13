import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";

import {
	decodeClientTelemetryBatch,
	sanitizeClientEvent,
	type ClientTelemetryEvent,
} from "./ingest.ts";

const validEvent = {
	type: "navigation",
	name: "web.navigation",
	path: "/patients",
	durationMs: 120,
} as const;

describe("ClientTelemetryBatch schema", () => {
	it("decodes a valid batch", () => {
		const exit = decodeClientTelemetryBatch({ events: [validEvent] });
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			expect(exit.value.events).toHaveLength(1);
			expect(exit.value.events[0]?.type).toBe("navigation");
		}
	});

	it("rejects malformed payloads", () => {
		expect(Exit.isSuccess(decodeClientTelemetryBatch(null))).toBe(false);
		expect(Exit.isSuccess(decodeClientTelemetryBatch({}))).toBe(false);
		expect(Exit.isSuccess(decodeClientTelemetryBatch({ events: "x" }))).toBe(false);
		expect(
			Exit.isSuccess(decodeClientTelemetryBatch({ events: [{ type: "bogus", name: "x" }] })),
		).toBe(false);
		expect(
			Exit.isSuccess(
				decodeClientTelemetryBatch({
					events: Array.from({ length: 101 }, () => validEvent),
				}),
			),
		).toBe(false);
	});

	it("accepts optional fields and attribute values", () => {
		const exit = decodeClientTelemetryBatch({
			events: [
				{
					...validEvent,
					timestamp: 1_700_000_000_000,
					status: 200,
					message: "boom",
					stack: "at x",
					traceparent: "00-abc",
					requestId: "r1",
					attributes: { route: "/a", count: 2, ok: true },
				},
			],
		});
		expect(Exit.isSuccess(exit)).toBe(true);
	});
});

describe("sanitizeClientEvent", () => {
	const base: ClientTelemetryEvent = {
		type: "error",
		name: "client.error",
		message: "x".repeat(600),
		stack: "s".repeat(5_000),
		path: "/patients/123?tab=notes&x=1",
		traceparent: "not-a-traceparent",
		attributes: {
			password: "leak",
			token: "leak",
			safe: "yes",
			nested: "y".repeat(300),
		},
	};

	it("truncates free text and strips query strings", () => {
		const out = sanitizeClientEvent(base);
		expect(out.message).toHaveLength(501);
		expect(out.stack).toHaveLength(4_001);
		expect(out.path).toBe("/patients/123");
	});

	it("drops invalid traceparent and sensitive attribute keys", () => {
		const out = sanitizeClientEvent(base);
		expect(out.traceparent).toBeUndefined();
		expect(out.attributes).toEqual({ safe: "yes", nested: "y".repeat(200) + "…" });
	});

	it("keeps valid traceparent", () => {
		const tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
		const out = sanitizeClientEvent({ ...base, traceparent: tp });
		expect(out.traceparent).toBe(tp);
	});

	it("rejects non-path-looking paths", () => {
		const out = sanitizeClientEvent({ ...base, path: "javascript:alert(1)" });
		expect(out.path).toBeUndefined();
	});

	it("handles missing optional fields", () => {
		const out = sanitizeClientEvent({ type: "event", name: "x" });
		expect(out.attributes).toBeUndefined();
		expect(out.path).toBeUndefined();
	});
});

describe("sanitizeClientEvent attribute values", () => {
	it("keeps non-string attribute values untouched", () => {
		const out = sanitizeClientEvent({
			type: "event",
			name: "x",
			attributes: { count: 3, ratio: 0.5, flag: true },
		});
		expect(out.attributes).toEqual({ count: 3, ratio: 0.5, flag: true });
	});
});
