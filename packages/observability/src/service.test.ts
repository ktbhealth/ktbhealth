import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { telemetryConfigFromEnv } from "./config.ts";
import { clientEvents, clientEventsDropped, tagged, telemetryErrors } from "./metrics.ts";
import {
	ingestClientEvents,
	makeLocalTelemetry,
	Telemetry,
	TelemetryLocalLive,
} from "./service.ts";
import type { ClientTelemetryBatch } from "./ingest.ts";

const config = telemetryConfigFromEnv({});

const batch = (events: unknown[]): ClientTelemetryBatch =>
	({ events }) as unknown as ClientTelemetryBatch;

const countOf = <S extends { readonly count: number | bigint }>(metric: Metric.Metric<never, S>) =>
	Effect.map(Metric.value(metric), (state) => Number(state.count));

describe("ingestClientEvents", () => {
	it("logs and counts each event by type", async () => {
		const registry = new Map();
		const program = Effect.gen(function* () {
			yield* ingestClientEvents(config)(
				batch([
					{ type: "navigation", name: "web.navigation", path: "/a", durationMs: 10 },
					{ type: "error", name: "client.error", message: "boom", stack: "at x" },
				]),
			);
			return yield* countOf(tagged(clientEvents, { type: "error" }));
		});
		const count = await Effect.runPromise(
			Effect.provideService(program, Metric.MetricRegistry, registry),
		);
		expect(count).toBe(1);
	});

	it("counts dropped batches when client telemetry is disabled", async () => {
		const disabled = telemetryConfigFromEnv({ KTB_TELEMETRY_CLIENT: "0" });
		const registry = new Map();
		const program = Effect.gen(function* () {
			yield* ingestClientEvents(disabled)(batch([{ type: "event", name: "x" }]));
			return yield* countOf(tagged(clientEventsDropped, { reason: "disabled" }));
		});
		const count = await Effect.runPromise(
			Effect.provideService(program, Metric.MetricRegistry, registry),
		);
		expect(count).toBe(1);
	});

	it("enforces clientTelemetry.sampleRate per event", async () => {
		const sampled = telemetryConfigFromEnv({ KTB_TELEMETRY_CLIENT_SAMPLE_RATE: "0.5" });
		const registry = new Map();
		// random() >= 0.5 drops, < 0.5 keeps — drive it deterministically.
		const rolls = [0.9, 0.1, 0.9, 0.2];
		const program = Effect.gen(function* () {
			yield* ingestClientEvents(
				sampled,
				() => rolls.shift() ?? 0.9,
			)(
				batch([
					{ type: "event", name: "drop-1" },
					{ type: "event", name: "keep-1" },
					{ type: "event", name: "drop-2" },
					{ type: "event", name: "keep-2" },
				]),
			);
			return {
				kept: yield* countOf(tagged(clientEvents, { type: "event" })),
				dropped: yield* countOf(tagged(clientEventsDropped, { reason: "sampled" })),
			};
		});
		const counts = await Effect.runPromise(
			Effect.provideService(program, Metric.MetricRegistry, registry),
		);
		expect(counts).toEqual({ kept: 2, dropped: 2 });
	});

	it("drops every event when the sample rate is 0", async () => {
		const zero = telemetryConfigFromEnv({ KTB_TELEMETRY_CLIENT_SAMPLE_RATE: "0" });
		const registry = new Map();
		const program = Effect.gen(function* () {
			yield* ingestClientEvents(zero)(batch([{ type: "event", name: "x" }]));
			return yield* countOf(tagged(clientEventsDropped, { reason: "sampled" }));
		});
		const count = await Effect.runPromise(
			Effect.provideService(program, Metric.MetricRegistry, registry),
		);
		expect(count).toBe(1);
	});

	it("counts ingest defects on telemetryErrors and never fails", async () => {
		const registry = new Map();
		// A throwing attribute getter defects inside sanitizeClientEvent —
		// the batch must still resolve and count once on stage=ingest.
		const evil = {
			attributes: {
				get boom(): string {
					throw new Error("getter exploded");
				},
			},
		};
		const program = Effect.gen(function* () {
			yield* ingestClientEvents(config)(batch([{ type: "event", name: "x", ...evil }]));
			return yield* countOf(tagged(telemetryErrors, { stage: "ingest" }));
		});
		const count = await Effect.runPromise(
			Effect.provideService(program, Metric.MetricRegistry, registry),
		);
		expect(count).toBe(1);
	});
});

describe("makeLocalTelemetry", () => {
	it("flush is a no-op, scrape returns prometheus text, health reports local exporters", async () => {
		const t = makeLocalTelemetry(config);
		await Effect.runPromise(t.flush);
		const text = await Effect.runPromise(t.scrape);
		expect(typeof text).toBe("string");
		expect(await Effect.runPromise(t.health)).toEqual({
			logs: "console",
			traces: "off",
			metrics: "prometheus",
		});
	});

	it("accepts custom health", async () => {
		const t = makeLocalTelemetry(config, { logs: "otlp", traces: "otlp", metrics: "otlp" });
		expect(await Effect.runPromise(t.health)).toEqual({
			logs: "otlp",
			traces: "otlp",
			metrics: "otlp",
		});
	});
});

describe("TelemetryLocalLive", () => {
	it("provides the Telemetry service through a layer", async () => {
		const runtime = ManagedRuntime.make(TelemetryLocalLive(config));
		try {
			const health = await runtime.runPromise(
				Effect.gen(function* () {
					const t = yield* Telemetry;
					return yield* t.health;
				}),
			);
			expect(health.logs).toBe("console");
		} finally {
			await runtime.dispose();
		}
	});
});

describe("ingestClientEvents field coverage", () => {
	it("handles minimal, fully-annotated and error events", async () => {
		const registry = new Map();
		const program = Effect.gen(function* () {
			yield* ingestClientEvents(config)(
				batch([
					{ type: "event", name: "" },
					{
						type: "request",
						name: "web.request",
						path: "/patients",
						status: 200,
						durationMs: 12,
						message: "ok",
						requestId: "r-1",
						timestamp: Date.now(),
						attributes: { route: "/patients" },
					},
					{
						type: "error",
						name: "client.error",
						message: "boom",
						stack: "at x",
					},
				]),
			);
			return yield* countOf(tagged(clientEvents, { type: "error" }));
		});
		const count = await Effect.runPromise(
			Effect.provideService(program, Metric.MetricRegistry, registry),
		);
		expect(count).toBe(1);
	});
});
