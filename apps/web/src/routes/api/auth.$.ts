import { createFileRoute } from "@tanstack/react-router";
import { auth, captcha } from "#/lib/platform.ts";

/** better-auth paths that accept raw credentials and need a bot check. */
const CREDENTIAL_PATHS = ["/sign-in/email", "/sign-up/email"];

/** better-auth catch-all: /api/auth/* (sign-in, sign-up, session, sign-out). */
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }) => auth.handler(request),
			POST: async ({ request }) => {
				const { pathname } = new URL(request.url);
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
								message: "Verificação de segurança falhou. Tente novamente.",
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
