import type { Driver } from "@ktb/driver-framework";
import { Email, EmailSendError, type EmailDriverEnv, type EmailSender } from "@ktb/email";
import * as Layer from "effect/Layer";

import { parseSmtpUrl, sendSmtpMessage, type SmtpConfig, type SmtpConnect } from "./smtp.ts";

export { parseSmtpUrl, sendSmtpMessage };
export type { SmtpConfig, SmtpConnect, SmtpSocket } from "./smtp.ts";

/**
 * SMTP impl of the EmailSender port. `connect` is the transport — the
 * deploy target injects `cloudflare:sockets` connect (workerd) or the
 * node:net stand-in (dev:node) as env.SMTP_CONNECT.
 */
export const makeSmtpEmailSender = (input: {
	readonly url: string | SmtpConfig;
	readonly from: string;
	readonly connect: SmtpConnect;
}): EmailSender => {
	const config = typeof input.url === "string" ? parseSmtpUrl(input.url) : input.url;
	return {
		async send(message) {
			await sendSmtpMessage(input.connect, config, { from: input.from, ...message });
		},
	};
};

/** Live layer for an SMTP-backed deployment. */
export const SmtpEmailLive = (url: string, from: string, connect: SmtpConnect) =>
	Layer.succeed(Email, makeSmtpEmailSender({ url, from, connect }));

/**
 * SMTP driver: eligible when SMTP_URL and EMAIL_FROM are bound — an
 * explicit opt-in that takes precedence over EMAIL_STUB in the driver's
 * registration order. Fails loudly when no socket transport is bound
 * (SMTP_CONNECT): a configured URL without a transport is a misconfig,
 * not a "no email" deployment.
 */
export const smtpEmailDriver: Driver<EmailDriverEnv> = {
	id: "email-smtp",
	port: Email.key,
	provides: (env) => {
		if (env.SMTP_CONNECT === undefined) {
			throw new EmailSendError("SMTP_URL is set but no SMTP_CONNECT socket transport is bound");
		}
		return SmtpEmailLive(env.SMTP_URL ?? "", env.EMAIL_FROM ?? "", env.SMTP_CONNECT as SmtpConnect);
	},
	when: (env) => Boolean(env.SMTP_URL) && Boolean(env.EMAIL_FROM),
};
