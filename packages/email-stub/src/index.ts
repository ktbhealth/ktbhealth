import type { EmailDriverEnv, EmailMessage, EmailSender } from "@ktb/email";
import type { Driver } from "@ktb/driver-framework";
import { Email } from "@ktb/email";
import * as Layer from "effect/Layer";

/**
 * Local-dev / e2e impl of the EmailSender port: nothing is delivered —
 * each message is written to the log so links (verification, invites)
 * can be followed from the dev server output. NEVER bind this in
 * production: users would never receive their email.
 */
export const makeStubEmailSender = (
	log: (line: string) => void = (line) => console.info(line),
): EmailSender => ({
	send: async (message: EmailMessage) => {
		log(
			`[email-stub] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
		);
	},
});

/** Live layer for local/dev deployments. */
export const StubEmailLive = Layer.succeed(Email, makeStubEmailSender());

/**
 * Local-dev driver: eligible only when EMAIL_STUB is set. Ordered
 * before the provider drivers so the stub wins when both are present.
 */
export const stubEmailDriver: Driver<EmailDriverEnv> = {
	id: "email-stub",
	port: Email.key,
	provides: () => StubEmailLive,
	when: (env) => Boolean(env.EMAIL_STUB),
};
