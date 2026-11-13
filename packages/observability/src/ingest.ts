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

/**
 * Hard cap on `POST /api/telemetry` request bodies, enforced BEFORE
 * JSON parsing. Sized above the worst legal batch — 100 events ×
 * bounded fields (120-char name, 500-char message, 4 000-char stack,
 * attributes) is ≈600 KiB — with headroom for JSON overhead.
 */
export const MAX_CLIENT_TELEMETRY_BODY_BYTES = 1_048_576;

/**
 * Read a request body as text with a hard byte cap. `Content-Length`
 * is only a hint (it can be absent on chunked uploads or simply lie),
 * so the stream itself is bounded: reading stops and `null` is returned
 * as soon as `maxBytes` is exceeded. Returns `""` for bodyless
 * requests; never throws on stream errors — a failed read yields `null`
 * (treated like an oversized/aborted body by the caller).
 */
export const readRequestBodyLimited = async (
	request: Request,
	maxBytes: number,
): Promise<string | null> => {
	const declared = Number(request.headers.get("content-length") ?? "");
	if (Number.isFinite(declared) && declared > maxBytes) return null;
	const stream = request.body;
	if (stream === null) return "";
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === undefined) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => {});
				return null;
			}
			chunks.push(value);
		}
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
};

const truncate = (value: string, max: number): string =>
	value.length > max ? `${value.slice(0, max)}…` : value;

const PATH_LIKE = /^\/?[A-Za-z0-9_\-./~%]*$/;

/** Client timestamps are wall-clock claims from an untrusted browser —
 * only a plausible window survives: not before 2000-01-01 and not more
 * than 5 minutes ahead of server time (clock skew tolerance). Anything
 * else is dropped rather than propagated into logs/traces. */
const MIN_PLAUSIBLE_TIMESTAMP_MS = 946_684_800_000; // 2000-01-01T00:00:00Z
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const plausibleTimestamp = (value: number | undefined): number | undefined =>
	value !== undefined &&
	Number.isFinite(value) &&
	value >= MIN_PLAUSIBLE_TIMESTAMP_MS &&
	value <= Date.now() + MAX_CLOCK_SKEW_MS
		? value
		: undefined;

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
		timestamp: plausibleTimestamp(event.timestamp),
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
