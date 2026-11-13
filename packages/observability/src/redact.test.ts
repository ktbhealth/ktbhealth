import { describe, expect, it, vi, afterEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

import {
	consoleJsonLogger,
	isSensitiveKey,
	redactLogRecord,
	redactString,
	redactValue,
} from "./redact.ts";

describe("redactValue", () => {
	it("redacts sensitive keys case-insensitively", () => {
		expect(
			redactValue({
				password: "hunter2",
				Authorization: "Bearer x",
				api_key: "k",
				ACCESS_TOKEN: "t",
				cookie: "c=1",
				safe: "value",
			}),
		).toEqual({
			password: "[redacted]",
			Authorization: "[redacted]",
			api_key: "[redacted]",
			ACCESS_TOKEN: "[redacted]",
			cookie: "[redacted]",
			safe: "value",
		});
	});

	it("recurses through nested objects and arrays", () => {
		expect(
			redactValue({
				outer: { inner: { secret: "s", ok: 1 } },
				list: [{ token: "t" }, { fine: true }],
			}),
		).toEqual({
			outer: { inner: { secret: "[redacted]", ok: 1 } },
			list: [{ token: "[redacted]" }, { fine: true }],
		});
	});

	it("passes primitives and non-plain objects through", () => {
		const date = new Date(0);
		expect(redactValue("str")).toBe("str");
		expect(redactValue(42)).toBe(42);
		expect(redactValue(null)).toBeNull();
		expect(redactValue(date)).toBe(date);
	});

	it("redacts bare key/secret/token/password field names in nested objects", () => {
		expect(
			redactValue({
				config: { key: "k", secret: "s", token: "t", password: "p" },
				list: [{ apiKey: "a" }, { nested: { sessionToken: "st" } }],
			}),
		).toEqual({
			config: {
				key: "[redacted]",
				secret: "[redacted]",
				token: "[redacted]",
				password: "[redacted]",
			},
			list: [{ apiKey: "[redacted]" }, { nested: { sessionToken: "[redacted]" } }],
		});
	});

	it("matches sensitive words across camelCase, snake_case and kebab-case", () => {
		for (const key of [
			"apiKey",
			"API_KEY",
			"api-key",
			"accessToken",
			"client_secret",
			"refresh-token",
			"privateKey",
			"X-Api-Key",
		]) {
			expect(isSensitiveKey(key)).toBe(true);
		}
	});

	it("does not redact benign keys that merely contain sensitive substrings", () => {
		for (const key of [
			"keyboard",
			"monkey",
			"cardiac",
			"requestId",
			"traceId",
			"spanId",
			"handlerType",
			"author",
			"wildcard",
		]) {
			expect(isSensitiveKey(key)).toBe(false);
		}
	});

	it("scrubs secret shapes embedded in string values", () => {
		expect(redactValue({ note: "used Bearer abcdef1234567890 to call api" })).toEqual({
			note: "used Bearer [redacted] to call api",
		});
		expect(redactValue({ note: "Basic dXNlcjpwYXNzMTIzNDU=" })).toEqual({
			note: "Basic [redacted]",
		});
		expect(redactValue({ dsn: "postgres://app:s3cretpw@db.internal:5432/app" })).toEqual({
			dsn: "postgres://app:[redacted]@db.internal:5432/app",
		});
		expect(redactValue({ contact: "reach ana.souza+ktb@example.com.br please" })).toEqual({
			contact: "reach [redacted-email] please",
		});
	});

	it("scrubs JWTs in string values", () => {
		const jwt =
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlfUP8THsR8U";
		expect(redactString(`token was ${jwt} ok`)).toBe("token was [redacted] ok");
	});
});

describe("redactLogRecord", () => {
	it("scrubs annotations and message payloads", () => {
		const record = {
			message: ["login failed"],
			annotations: { user: "u1", password: "p" },
		};
		const out = redactLogRecord(record);
		expect(out.annotations).toEqual({ user: "u1", password: "[redacted]" });
		expect(out.message).toEqual(["login failed"]);
	});
});

describe("consoleJsonLogger", () => {
	afterEach(() => vi.restoreAllMocks());

	it("emits single-line JSON with redacted annotations", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		Effect.runSync(
			Effect.logInfo("user login").pipe(
				Effect.annotateLogs({ username: "ana", password: "secret" }),
				Effect.provide(Logger.layer([consoleJsonLogger])),
			),
		);
		expect(spy).toHaveBeenCalledTimes(1);
		const line = spy.mock.calls[0]?.[0] as string;
		const parsed = JSON.parse(line);
		expect(parsed.message).toBe("user login");
		expect(parsed.annotations.username).toBe("ana");
		expect(parsed.annotations.password).toBe("[redacted]");
		expect(parsed.level).toBe("INFO");
	});
});
