import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

import { sampledTracer } from "./sampler.ts";

const makeTracer = () => {
	const spans: Tracer.NativeSpan[] = [];
	const tracer = Tracer.make({
		span: (options) => {
			const span = new Tracer.NativeSpan(options);
			spans.push(span);
			return span;
		},
	});
	return { tracer, spans };
};

/** Run `name` span and report the sampled flag the runtime/exporter sees
 * (the wrapper's span, not the inner native one). */
const sampledFlag = (tracer: Tracer.Tracer, name: string, parent?: Tracer.AnySpan) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const span = yield* Effect.currentSpan;
			return span.sampled;
		}).pipe(
			Effect.withSpan(name, parent === undefined ? undefined : { parent }),
			Effect.provideService(Tracer.Tracer, tracer),
		),
	);

describe("sampledTracer", () => {
	it("returns the same tracer at rate >= 1", () => {
		const { tracer } = makeTracer();
		expect(sampledTracer(tracer, 1)).toBe(tracer);
		expect(sampledTracer(tracer, 1.5)).toBe(tracer);
	});

	it("keeps sampled root spans when the coin lands under the rate", async () => {
		const { tracer } = makeTracer();
		const sampled = sampledTracer(tracer, 0.5, () => 0.4);
		expect(await sampledFlag(sampled, "root")).toBe(true);
	});

	it("marks root spans unsampled when the coin exceeds the rate", async () => {
		const { tracer } = makeTracer();
		const sampled = sampledTracer(tracer, 0.5, () => 0.9);
		expect(await sampledFlag(sampled, "root")).toBe(false);
	});

	it("drops every trace at rate <= 0", async () => {
		const { tracer } = makeTracer();
		const sampled = sampledTracer(tracer, 0, () => 0);
		expect(await sampledFlag(sampled, "root")).toBe(false);
	});

	it("inherits sampling for child spans of a sampled parent", async () => {
		const { tracer } = makeTracer();
		// rate 0 drops roots; a sampled parent must keep the child alive.
		const sampled = sampledTracer(tracer, 0, () => 1);
		const parent = Tracer.externalSpan({ spanId: "p1", traceId: "t1", sampled: true });
		expect(await sampledFlag(sampled, "child", parent)).toBe(true);
	});

	it("keeps unsampled parents' children unsampled (runtime default)", async () => {
		const { tracer } = makeTracer();
		const sampled = sampledTracer(tracer, 1, () => 0);
		const parent = Tracer.externalSpan({ spanId: "p1", traceId: "t1", sampled: false });
		expect(await sampledFlag(sampled, "child", parent)).toBe(false);
	});

	it("passes through spans the runtime already marked unsampled", async () => {
		const { tracer } = makeTracer();
		const sampled = sampledTracer(tracer, 0.5, () => 0.1);
		const flag = await Effect.runPromise(
			Effect.gen(function* () {
				return (yield* Effect.currentSpan).sampled;
			}).pipe(
				Effect.withSpan("explicit", { sampled: false }),
				Effect.provideService(Tracer.Tracer, sampled),
			),
		);
		expect(flag).toBe(false);
	});

	it("marks the underlying span unsampled so exporters drop it", async () => {
		const { tracer, spans } = makeTracer();
		const sampled = sampledTracer(tracer, 0, () => 1);
		await Effect.runPromise(
			Effect.void.pipe(Effect.withSpan("wrapped"), Effect.provideService(Tracer.Tracer, sampled)),
		);
		// Exporters (e.g. OtlpTracer) inspect the inner span's `sampled`
		// flag on `end()` — it must be false natively, not just on a
		// wrapper. Regression: a span wrapper reporting sampled:false
		// still exported because end() delegated to the inner span.
		expect(spans[0]?.sampled).toBe(false);
	});

	it("preserves tracer.context on the wrapper", () => {
		const context = <X>(_primitive: Tracer.EffectPrimitive<X>): X => undefined as X;
		const tracer = Tracer.make({ context, span: () => new Tracer.NativeSpan({} as never) });
		expect(sampledTracer(tracer, 0.5).context).toBe(context);
	});
});
