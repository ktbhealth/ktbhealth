import type { EmailDriverEnv, EmailSender } from "@ktb/email";
import type { Driver } from "@ktb/driver-framework";
import { Email, EmailSendError, hasEmailProvider } from "@ktb/email";
import * as Layer from "effect/Layer";

/**
 * The slice of the Workers `send_email` binding (Cloudflare Email
 * Service) this adapter uses — the builder overload of `SendEmail.send`.
 * Structural on purpose: no dependency on workers-types.
 */
export interface CloudflareSendEmail {
	send(builder: {
		from: string;
		to: string;
		subject: string;
		text: string;
		html?: string;
	}): Promise<unknown>;
}

const isSendEmailBinding = (value: unknown): value is CloudflareSendEmail =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { send?: unknown }).send === "function";

/** Cloudflare Email Service impl of the EmailSender port. */
export const makeCloudflareEmailSender = (
	binding: CloudflareSendEmail,
	from: string,
): EmailSender => ({
	async send(message) {
		try {
			await binding.send({
				from,
				to: message.to,
				subject: message.subject,
				text: message.text,
				...(message.html !== undefined ? { html: message.html } : {}),
			});
		} catch (cause) {
			throw new EmailSendError(
				`cloudflare email send failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause },
			);
		}
	},
});

/** Live layer for a Cloudflare-Email-backed deployment. */
export const CloudflareEmailLive = (binding: CloudflareSendEmail, from: string) =>
	Layer.succeed(Email, makeCloudflareEmailSender(binding, from));

/**
 * Cloudflare Email Service driver: eligible when the `EMAIL` send
 * binding and `EMAIL_FROM` are bound and EMAIL_STUB is not set (the stub
 * keeps precedence for local dev).
 */
export const cloudflareEmailDriver: Driver<EmailDriverEnv> = {
	id: "email-cloudflare",
	port: Email.key,
	provides: (env) => CloudflareEmailLive(env.EMAIL as CloudflareSendEmail, env.EMAIL_FROM ?? ""),
	when: (env) => !env.EMAIL_STUB && hasEmailProvider(env) && isSendEmailBinding(env.EMAIL),
};
