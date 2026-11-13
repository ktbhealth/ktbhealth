import { describe, expect, it, vi, afterEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";

import { consoleJsonLogger, redactLogRecord, redactValue } from "./redact.ts";

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
