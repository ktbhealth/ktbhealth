import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/platform.ts";

/** better-auth catch-all: /api/auth/* (sign-in, sign-up, session, sign-out). */
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }) => auth.handler(request),
			POST: async ({ request }) => auth.handler(request),
		},
	},
});
