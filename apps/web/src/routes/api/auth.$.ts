import { createFileRoute } from "@tanstack/react-router";
import { auth, CaptchaLive } from "#/lib/platform.ts";
import { Captcha } from "@ktb/captcha";
import { Effect } from "effect";

/** better-auth paths that need a bot check: they accept raw credentials
 * or make the server send email to a caller-supplied address. */
const CREDENTIAL_PATHS = ["/sign-in/email", "/sign-up/email", "/send-verification-email"];

/** better-auth catch-all: /api/auth/* (sign-in, sign-up, session, sign-out). */
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }) => auth.handler(request),
			POST: async ({ request }) => {
				const { pathname } = new URL(request.url);
				const captcha = await Effect.runPromise(
					Effect.service(Captcha).pipe(Effect.provide(CaptchaLive)),
				);
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
				return auth.handler(request);
			},
		},
	},
});
