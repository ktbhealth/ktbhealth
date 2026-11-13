import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

/**
 * Head-sampling wrapper for any `Tracer`.
 *
 * Effect computes `options.sampled` before `tracer.span` is invoked
 * (explicit flag → unsampled parent → `MinimumTraceLevel`), so sampling
 * can't be injected any earlier — but exporters inspect the *span's*
 * `sampled` flag (`OtlpTracer` drops `span.sampled === false`) and
 * children read their parent's flag for parent-based decisions. Passing
 * `sampled: false` through to the underlying `tracer.span` therefore
 * drops the whole trace consistently: the native span is born unsampled,
 * descendants see an unsampled parent and the runtime forces them off.
 * (Wrapping the returned span instead does NOT work — `end()` delegates
 * to the inner span, whose own `sampled` flag is what the exporter
 * checks.)
 *
 * Decision order (OTel parent-based convention):
 * 1. Spans the runtime already marked unsampled pass through untouched.
 * 2. Non-root spans inherit — a sampled parent keeps the trace alive.
 * 3. Root spans (no parent, or `root: true`) flip a weighted coin:
 *    `rate >= 1` keeps the tracer as-is, `rate <= 0` drops every trace.
 */
export const sampledTracer = (
	tracer: Tracer.Tracer,
	rate: number,
	random: () => number = Math.random,
): Tracer.Tracer => {
	if (rate >= 1) return tracer;
	return Tracer.make({
		context: tracer.context,
		span: (options) => {
			if (!options.sampled) return tracer.span(options);
			const isRoot = options.root || Option.isNone(options.parent);
			if (!isRoot) return tracer.span(options);
			return tracer.span(random() < rate ? options : { ...options, sampled: false });
		},
	});
};
