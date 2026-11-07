/**
 * Bot-check port: verifies a client-solved challenge token server-side.
 * Provider-agnostic; impls live in sibling packages (e.g. @ktb/captcha-turnstile).
 */
export interface CaptchaVerifier {
	/**
	 * True when the token proves the challenge was solved by a human.
	 * Implementations must fail closed: missing/invalid tokens, network
	 * errors and malformed responses all resolve to false.
	 */
	verify(token: string | undefined, remoteIp?: string): Promise<boolean>;
}
