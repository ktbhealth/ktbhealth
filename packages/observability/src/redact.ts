import * as Formatter from "effect/Formatter";
import * as Logger from "effect/Logger";

/**
 * Log redaction — the last line of defense before a record leaves the
 * process. Key-based scrubbing runs on every annotation/attribute bag:
 * anything whose key matches a sensitive pattern is replaced with
 * "[redacted]" regardless of value, recursively through objects and
 * arrays. Messages are already-interpolated strings and cannot be
 * scrubbed reliably — the contract is: sensitive data belongs in
 * annotations (scrubbed here), never interpolated into messages.
 */

const SENSITIVE_KEY =
	/(pass(word)?|passwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|authorization|cookie|session|jwt|bearer|ssn|cpf|card|cvv|otp|pin)/i;

const REDACTED = "[redacted]";

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

/** Deep-redact sensitive keys in an arbitrary value. Non-plain objects
 * (Date, Map, Error, class instances) pass through untouched — the JSON
 * formatter handles their serialization. */
export const redactValue = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(redactValue);
	if (!isPlainObject(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(entry);
	}
	return out;
};

/** Redact the structured payload `Logger.formatStructured` produces —
 * annotations and the interpolated message list are both scrubbed. */
export const redactLogRecord = <
	T extends { annotations: Record<string, unknown>; message: unknown },
>(
	record: T,
): T => ({
	...record,
	message: redactValue(record.message),
	annotations: redactValue(record.annotations) as Record<string, unknown>,
});

/**
 * Single-line JSON console logger with redaction — the local/dev sink and
 * the always-on fallback merged under OTLP exporters. Output shape is
 * identical to `Logger.consoleJson` (workerd Logs/Wrangler observability
 * friendly): one JSON object per line on stdout.
 */
export const consoleJsonLogger: Logger.Logger<unknown, void> = Logger.withConsoleLog(
	Logger.map(Logger.formatStructured, (record) => Formatter.formatJson(redactLogRecord(record))),
);
