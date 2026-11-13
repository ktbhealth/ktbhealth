import * as Schema from "effect/Schema";

/**
 * Client (browser) telemetry wire contract — the payload `POST
 * /api/telemetry` accepts. Deliberately small and boring: a batch of
 * typed events with bounded attributes. Everything is re-validated and
 * re-sanitized server-side; the client is untrusted input.
 */

export const CLIENT_EVENT_TYPES = ["event", "error", "navigation", "request"] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

const AttributeValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
export type ClientAttributeValue = typeof AttributeValue.Type;

// Cardinality is enforced in `sanitizeClientEvent` (key filter + slice) —
// Schema records have no length to check.
const Attributes = Schema.Record(Schema.String, AttributeValue);

export const ClientTelemetryEvent = Schema.Struct({
	type: Schema.Literals(CLIENT_EVENT_TYPES),
	/** Event name — e.g. "web.navigation", "api.request", or a custom
	 * domain event reported via `reportTelemetryEvent`. */
	name: Schema.String.check(Schema.isMaxLength(120)),
	/** Client-side epoch millis. */
	timestamp: Schema.optional(Schema.Number),
	durationMs: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
	status: Schema.optional(
		Schema.Union([Schema.Number, Schema.String.check(Schema.isMaxLength(32))]),
	),
	message: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
	stack: Schema.optional(Schema.String.check(Schema.isMaxLength(4_000))),
	/** Route path or URL pathname — never the query string. */
	path: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
	traceparent: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
	requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
	attributes: Schema.optional(Attributes),
});
export type ClientTelemetryEvent = typeof ClientTelemetryEvent.Type;

export const ClientTelemetryBatch = Schema.Struct({
	events: Schema.Array(ClientTelemetryEvent).check(Schema.isMaxLength(100)),
});
export type ClientTelemetryBatch = typeof ClientTelemetryBatch.Type;

/** Decode a raw request body into a validated batch — returns an `Exit`
 * (success carries the typed batch; failure carries `SchemaError`). */
export const decodeClientTelemetryBatch = Schema.decodeUnknownExit(ClientTelemetryBatch);

const truncate = (value: string, max: number): string =>
	value.length > max ? `${value.slice(0, max)}…` : value;

const PATH_LIKE = /^\/?[A-Za-z0-9_\-./~%]*$/;

/**
 * Final scrub before a client event becomes a log record: paths must look
 * like paths (no `?`, no scheme), free-text fields are truncated, and
 * sensitive-looking attribute keys are dropped entirely — client input
 * never reaches a log line unfiltered.
 */
export const sanitizeClientEvent = (event: ClientTelemetryEvent): ClientTelemetryEvent => {
	const attributes = event.attributes;
	const cleanAttributes =
		attributes === undefined
			? undefined
			: Object.fromEntries(
					Object.entries(attributes)
						.filter(([key]) => !/(pass|secret|token|key|auth|cookie|session|ssn|cpf)/i.test(key))
						.slice(0, 24)
						.map(([key, value]) => [
							key.slice(0, 60),
							typeof value === "string" ? truncate(value, 200) : value,
						]),
				);
	const path = event.path?.split("?")[0];
	return {
		...event,
		name: truncate(event.name, 120),
		message: event.message === undefined ? undefined : truncate(event.message, 500),
		stack: event.stack === undefined ? undefined : truncate(event.stack, 4_000),
		path: path !== undefined && PATH_LIKE.test(path) ? truncate(path, 300) : undefined,
		traceparent:
			event.traceparent !== undefined &&
			/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(event.traceparent)
				? event.traceparent
				: undefined,
		attributes: cleanAttributes,
	};
};
