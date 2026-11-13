import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

import { Email, EmailSendError } from "@ktb/email";
import { cloudflareEmailDriver, makeCloudflareEmailSender } from "./index.ts";

const FROM = "noreply@ktb.test";

describe("cloudflare email sender", () => {
	it("sends through the binding with the configured sender", async () => {
		const send = vi.fn<(builder: unknown) => Promise<unknown>>(async () => ({ messageId: "m1" }));
		const sender = makeCloudflareEmailSender({ send }, FROM);
		await sender.send({ to: "a@ktb.test", subject: "Hi", text: "plain" });
		expect(send).toHaveBeenCalledWith({
			from: FROM,
			to: "a@ktb.test",
			subject: "Hi",
			text: "plain",
		});
	});

	it("forwards the html alternative when present", async () => {
		const send = vi.fn<(builder: unknown) => Promise<unknown>>(async () => ({}));
		const sender = makeCloudflareEmailSender({ send }, FROM);
		await sender.send({ to: "a@ktb.test", subject: "Hi", text: "plain", html: "<p>rich</p>" });
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ html: "<p>rich</p>" }));
	});

	it("wraps provider failures in EmailSendError", async () => {
		const cause = new Error("sender not verified");
		const sender = makeCloudflareEmailSender({ send: async () => Promise.reject(cause) }, FROM);
		const error = await sender
			.send({ to: "a@ktb.test", subject: "Hi", text: "plain" })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(EmailSendError);
		expect((error as EmailSendError).message).toBe(
			"cloudflare email send failed: sender not verified",
		);
		expect((error as EmailSendError).cause).toBe(cause);
	});

	it("stringifies non-Error rejections", async () => {
		const sender = makeCloudflareEmailSender({ send: async () => Promise.reject("nope") }, FROM);
		await expect(sender.send({ to: "a@ktb.test", subject: "Hi", text: "plain" })).rejects.toThrow(
			"cloudflare email send failed: nope",
		);
	});
});

describe("cloudflareEmailDriver", () => {
	const binding = { send: async () => ({}) };

	it("is eligible only with a send binding and sender, without the stub", () => {
		expect(cloudflareEmailDriver.id).toBe("email-cloudflare");
		expect(cloudflareEmailDriver.port).toBe(Email.key);
		expect(cloudflareEmailDriver.when?.({})).toBe(false);
		expect(cloudflareEmailDriver.when?.({ EMAIL: binding })).toBe(false);
		expect(cloudflareEmailDriver.when?.({ EMAIL_FROM: FROM })).toBe(false);
		expect(cloudflareEmailDriver.when?.({ EMAIL: "not-a-binding", EMAIL_FROM: FROM })).toBe(false);
		expect(cloudflareEmailDriver.when?.({ EMAIL: {}, EMAIL_FROM: FROM })).toBe(false);
		expect(cloudflareEmailDriver.when?.({ EMAIL: binding, EMAIL_FROM: FROM })).toBe(true);
		expect(
			cloudflareEmailDriver.when?.({ EMAIL: binding, EMAIL_FROM: FROM, EMAIL_STUB: "1" }),
		).toBe(false);
	});

	it("provides a sender bound to the env binding", async () => {
		const send = vi.fn<(builder: { from: string }) => Promise<unknown>>(async () => ({}));
		const resolve = (env: Parameters<typeof cloudflareEmailDriver.provides>[0]) =>
			Effect.runPromise(
				Effect.service(Email).pipe(
					Effect.provide(cloudflareEmailDriver.provides(env) as Layer.Layer<Email, never, never>),
				),
			);
		const email = await resolve({ EMAIL: { send }, EMAIL_FROM: FROM });
		await email?.send({ to: "a@ktb.test", subject: "Hi", text: "plain" });
		expect(send.mock.calls[0]?.[0].from).toBe(FROM);
		const unset = await resolve({ EMAIL: { send } });
		await unset?.send({ to: "a@ktb.test", subject: "Hi", text: "plain" });
		expect(send.mock.calls[1]?.[0].from).toBe("");
	});
});
