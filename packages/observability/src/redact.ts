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
 *
 * Two layers, both applied to every string leaf:
 *  - KEY scrub: the object's key decides. Keys are normalized (camelCase
 *    split, separators dropped) and matched word-by-word against a
 *    sensitive vocabulary, so `apiKey`, `api_key`, `api-key` and `key`
 *    itself all redact while `keyboard`/`monkey`/`requestId` survive.
 *  - VALUE scrub: well-known secret *shapes* embedded in string values
 *    (Authorization/Bearer/Basic credentials, `scheme://user:pass@host`
 *    connection strings, JWTs, email addresses) are masked in place.
 *    Values under safe keys are still scrubbed — a token pasted into a
 *    `note` field does not survive either.
 */

const REDACTED = "[redacted]";

/** Sensitive key vocabulary, matched per normalized word. Plurals are
 * listed explicitly — `tokens`/`keys` redact like their singulars. */
const SENSITIVE_WORDS = new Set([
	"password",
	"passwords",
	"passwd",
	"passwds",
	"pwd",
	"secret",
	"secrets",
	"token",
	"tokens",
	"key",
	"keys",
	"apikey",
	"apikeys",
	"authorization",
	"auth",
	"oauth",
	"bearer",
	"jwt",
	"cookie",
	"cookies",
	"session",
	"sessions",
	"credential",
	"credentials",
	"ssn",
	"cpf",
	"card",
	"cards",
	"cvv",
	"otp",
	"pin",
]);

/** Split a key into lowercase words: `apiKey` → ["api","key"],
 * `x-api_key` → ["x","api","key"], `requestId` → ["request","id"]. */
const keyWords = (key: string): string[] =>
	key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);

/** True when any normalized word of `key` is sensitive. Word-level
 * matching keeps `keyboard`, `monkey` and `cardiac` safe while bare
 * `key`, `token`, `password` and `secret` field names redact. */
export const isSensitiveKey = (key: string): boolean =>
	keyWords(key).some((word) => SENSITIVE_WORDS.has(word));

// --- Value-level secret shapes -------------------------------------------
// Order matters: run the most specific patterns first. Every pattern
// replaces only the secret portion — surrounding context (scheme, label)
// stays readable for debugging.

/** `Bearer <cred>` / `Basic <cred>` authorization payloads. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** `scheme://user:password@host` — keeps user+host, masks the password. */
const URL_CREDENTIALS = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/@:]+:)[^\s/@]+@/g;
/** Compact JWS/JWT (`eyJ…​.…​.…`) — header always base64-`{"`. */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g;
/** RFC-5322-ish email addresses — PII that must not reach log sinks. */
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Mask well-known secret shapes inside a single string value. */
export const redactString = (value: string): string =>
	value
		.replace(AUTH_SCHEME, "$1 [redacted]")
		.replace(URL_CREDENTIALS, "$1[redacted]@")
		.replace(JWT, REDACTED)
		.replace(EMAIL, "[redacted-email]");

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

/** Deep-redact sensitive keys in an arbitrary value. Non-plain objects
 * (Date, Map, Error, class instances) pass through untouched — the JSON
 * formatter handles their serialization. String leaves additionally get
 * value-level secret scrubbing (see `redactString`). */
export const redactValue = (value: unknown): unknown => {
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.map(redactValue);
	if (!isPlainObject(value)) return value;
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		out[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry);
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
