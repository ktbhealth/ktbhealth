import { afterEach, describe, expect, it, vi } from "vitest";

import { Email } from "@ktb/email";
import { makeStubEmailSender, StubEmailLive, stubEmailDriver } from "./index.ts";

afterEach(() => vi.restoreAllMocks());

describe("stub email sender", () => {
	it("logs the message instead of delivering it", async () => {
		const lines: string[] = [];
		const sender = makeStubEmailSender((line) => lines.push(line));
		await sender.send({ to: "a@ktb.test", subject: "Verify", text: "http://x/verify?t=1" });
		expect(lines).toEqual(['[email-stub] to=a@ktb.test subject="Verify"\nhttp://x/verify?t=1']);
	});

	it("defaults to console.info", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await makeStubEmailSender().send({ to: "a@ktb.test", subject: "Hi", text: "body" });
		expect(info).toHaveBeenCalledWith('[email-stub] to=a@ktb.test subject="Hi"\nbody');
	});
});

describe("stubEmailDriver", () => {
	it("is eligible only when EMAIL_STUB is set", () => {
		expect(stubEmailDriver.id).toBe("email-stub");
		expect(stubEmailDriver.port).toBe(Email.key);
		expect(stubEmailDriver.when?.({})).toBe(false);
		expect(stubEmailDriver.when?.({ EMAIL_STUB: "1" })).toBe(true);
	});

	it("provides the stub layer", () => {
		expect(stubEmailDriver.provides({ EMAIL_STUB: "1" })).toBe(StubEmailLive);
	});
});
