import * as m from "#/paraglide/messages.js";

/**
 * Sign-up verification email, in the locale of the request that triggered
 * it: messages resolve through paraglide's request-scoped `getLocale()`
 * (ktb-locale cookie, see src/start.ts), so the copy follows the language
 * the user is browsing in.
 */
export const verificationEmail = (input: {
	readonly name: string | null;
	readonly url: string;
}): { subject: string; text: string } => ({
	subject: m.email_verify_subject(),
	text: [
		input.name ? m.email_verify_greeting({ name: input.name }) : m.email_verify_greeting_anon(),
		"",
		m.email_verify_body(),
		input.url,
		"",
		m.email_verify_ignore(),
	].join("\n"),
});
