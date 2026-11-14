import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Email, EmailSendError, hasEmailProvider, nullEmailDriver } from "./index.ts";

describe("EmailSendError", () => {
	it("carries the provider failure as cause", () => {
		const cause = new Error("boom");
		const error = new EmailSendError("send failed", { cause });
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("EmailSendError");
		expect(error.message).toBe("send failed");
		expect(error.cause).toBe(cause);
		expect(new EmailSendError("no cause").cause).toBeUndefined();
	});
});

describe("hasEmailProvider", () => {
	it("requires both the binding and the sender address", () => {
		expect(hasEmailProvider({})).toBe(false);
		expect(hasEmailProvider({ EMAIL: {} })).toBe(false);
		expect(hasEmailProvider({ EMAIL_FROM: "noreply@ktb.test" })).toBe(false);
		expect(hasEmailProvider({ EMAIL: {}, EMAIL_FROM: "noreply@ktb.test" })).toBe(true);
	});
});

describe("nullEmailDriver", () => {
	it("is eligible only when no email env is set", () => {
		expect(nullEmailDriver.id).toBe("email-none");
		expect(nullEmailDriver.port).toBe(Email.key);
		expect(nullEmailDriver.when?.({})).toBe(true);
		expect(nullEmailDriver.when?.({ EMAIL: {} })).toBe(true);
		expect(nullEmailDriver.when?.({ EMAIL_STUB: "1" })).toBe(false);
		expect(nullEmailDriver.when?.({ SMTP_URL: "smtp://localhost:1025" })).toBe(false);
		expect(nullEmailDriver.when?.({ EMAIL: {}, EMAIL_FROM: "noreply@ktb.test" })).toBe(false);
	});

	it("provides a null Email service", async () => {
		const email = await Effect.runPromise(
			Effect.service(Email).pipe(
				Effect.provide(nullEmailDriver.provides({}) as Layer.Layer<Email, never, never>),
			),
		);
		expect(email).toBeNull();
	});
});
