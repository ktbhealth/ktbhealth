import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

/**
 * Head-sampling wrapper for any `Tracer`.
 *
 * Effect computes `options.sampled` before `tracer.span` is invoked
 * (explicit flag → unsampled parent → `MinimumTraceLevel`), so sampling
 * can't be injected as an option — but the *returned span* is what
 * exporters inspect (`OtlpTracer` drops `span.sampled === false`) and
 * what children read for parent-based decisions. Wrapping the span and
 * reporting `sampled: false` therefore drops the whole trace consistently:
 * descendants see an unsampled parent and the runtime forces them off.
 *
 * Decision order (OTel parent-based convention):
 * 1. Spans the runtime already marked unsampled pass through untouched.
 * 2. Non-root spans inherit — a sampled parent keeps the trace alive.
 * 3. Root spans (no parent, or `root: true`) flip a weighted coin:
 *    `rate >= 1` keeps the tracer as-is, `rate <= 0` drops every trace.
 */
const unsampled = (span: Tracer.Span): Tracer.Span => ({
	_tag: "Span",
	name: span.name,
	spanId: span.spanId,
	traceId: span.traceId,
	parent: span.parent,
	annotations: span.annotations,
	get status() {
		return span.status;
	},
	attributes: span.attributes,
	links: span.links,
	sampled: false,
	kind: span.kind,
	end: (endTime, exit) => span.end(endTime, exit),
	attribute: (key, value) => span.attribute(key, value),
	event: (name, startTime, attributes) => span.event(name, startTime, attributes),
	addLinks: (links) => span.addLinks(links),
});

export const sampledTracer = (
	tracer: Tracer.Tracer,
	rate: number,
	random: () => number = Math.random,
): Tracer.Tracer => {
	if (rate >= 1) return tracer;
	return Tracer.make({
		context: tracer.context,
		span: (options) => {
			const span = tracer.span(options);
			if (!options.sampled) return span;
			const isRoot = options.root || Option.isNone(options.parent);
			if (!isRoot) return span;
			return random() < rate ? span : unsampled(span);
		},
	});
};
