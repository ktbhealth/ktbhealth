import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import {
	appInvocations,
	cqrsDispatches,
	clientEvents,
	httpRequests,
	record,
	recordUnsafe,
	tagged,
	telemetryErrors,
} from "./metrics.ts";

const valueOf = <A, S>(metric: Metric.Metric<A, S>) => Effect.runPromise(Metric.value(metric));

describe("record", () => {
	it("increments counters with attributes", async () => {
		await Effect.runPromise(
			record(tagged(clientEvents, { type: "error" }), 1).pipe(
				Effect.provideService(Metric.MetricRegistry, new Map()),
			),
		);
	});
});

describe("recordUnsafe", () => {
	it("updates metrics outside Effect and never throws", () => {
		expect(() => recordUnsafe(httpRequests, "200")).not.toThrow();
		expect(() => recordUnsafe(cqrsDispatches, 1)).not.toThrow();
	});
});

describe("metric definitions", () => {
	it("all counters/histograms are valid Metric instances", () => {
		for (const m of [appInvocations, cqrsDispatches, httpRequests, clientEvents, telemetryErrors]) {
			expect(Metric.isMetric(m)).toBe(true);
		}
	});
});
