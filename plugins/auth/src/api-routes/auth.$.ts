import { Effect } from "effect";

import { Captcha } from "@ktb/captcha";
import { createPluginApiRoute, getServerRuntime, run } from "@ktb/server-fns";

/** better-auth paths that need a bot check: they accept raw credentials
 * or make the server send email to a caller-supplied address. */
const CREDENTIAL_PATHS = ["/sign-in/email", "/sign-up/email", "/send-verification-email"];

/**
 * Dispatch one request to the credential provider's catch-all handler.
 * The better-auth instance is composed by the host (apps/web keeps it
 * out of the driver registry on purpose — see @ktb/app-host) and
 * reaches this plugin through the `authHandler` server-runtime
 * capability; plugins never import the adapter.
 */
const handleAuthRequest = (request: Request): Promise<Response> => {
	const handler = getServerRuntime().authHandler;
	if (handler === undefined) {
		return Promise.resolve(new Response("auth handler unavailable", { status: 500 }));
	}
	return handler(request);
};

/**
 * better-auth catch-all: /api/auth/* (sign-in, sign-up, session,
 * sign-out). Moved from apps/web/src/routes/api/auth.$.ts (P-062) —
 * mounted into the host's virtual route tree by `authRoutesPlugin`
 * (physical("/api", "src/api-routes")); the session/runtime boundary
 * is @ktb/server-fns, so no host imports are needed.
 *
 * Credential posts (/sign-in/email, /sign-up/email) pass the Captcha
 * bot check first: the verifier comes from the composed runtime via
 * `run` (CaptchaLive is part of the app core layer), resolves null
 * when bot checks are disabled, and fails closed on bad tokens.
 */
export const Route = createPluginApiRoute("auth.routes")("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }) => handleAuthRequest(request),
			POST: async ({ request }) => {
				const { pathname } = new URL(request.url);
				const captcha = await run(Effect.service(Captcha));
				if (captcha && CREDENTIAL_PATHS.some((p) => pathname.endsWith(p))) {
					const body = (await request
						.clone()
						.json()
						.catch(() => null)) as { captchaToken?: string } | null;
					const remoteIp = request.headers.get("cf-connecting-ip") ?? undefined;
					const ok = await captcha.verify(body?.captchaToken, remoteIp);
					if (!ok) {
						return Response.json(
							{
								code: "CAPTCHA_FAILED",
								message: "Security verification failed. Please try again.",
							},
							{ status: 403 },
						);
					}
				}
				return handleAuthRequest(request);
			},
		},
	},
});
