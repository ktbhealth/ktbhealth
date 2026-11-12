import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type { Driver } from "@ktb/driver-framework";

/** A transactional email. The sender address is deployment config owned
 * by the driver, never by the caller. */
export interface EmailMessage {
	readonly to: string;
	readonly subject: string;
	/** Plain-text body — always required; `html` is an optional rich alternative. */
	readonly text: string;
	readonly html?: string;
}

/** Delivery was refused or failed at the provider. */
export class EmailSendError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "EmailSendError";
	}
}

/**
 * Outbound email port: hands a message to the provider for delivery.
 * Provider-agnostic; impls live in sibling packages (e.g. @ktb/email-cloudflare).
 */
export interface EmailSender {
	/** Resolves once the provider accepted the message; rejects with
	 * {@link EmailSendError} otherwise. */
	send(message: EmailMessage): Promise<void>;
}

/**
 * Email service — the configured sender, or null when outbound email is
 * disabled for this deployment (flows that need it must degrade, not crash).
 */
export class Email extends Context.Service<Email, EmailSender | null>()("@ktb/email/Email") {}

/** Env slice read by Email port drivers (mirrors app-host AppEnv). */
export interface EmailDriverEnv {
	readonly EMAIL_STUB?: unknown;
	/** Provider send binding — opaque here; each driver narrows its own. */
	readonly EMAIL?: unknown;
	/** Sender address, e.g. "noreply@example.com". */
	readonly EMAIL_FROM?: string;
}

/** True when a provider binding and its sender address are both bound. */
export const hasEmailProvider = (env: EmailDriverEnv): boolean =>
	Boolean(env.EMAIL) && Boolean(env.EMAIL_FROM);

/**
 * Disabled email driver: Email resolves to null. Last in the email driver
 * list — eligible only when neither EMAIL_STUB nor a provider is bound.
 */
export const nullEmailDriver: Driver<EmailDriverEnv> = {
	id: "email-none",
	port: Email.key,
	provides: () => Layer.succeed(Email, null),
	when: (env) => !env.EMAIL_STUB && !hasEmailProvider(env),
};
