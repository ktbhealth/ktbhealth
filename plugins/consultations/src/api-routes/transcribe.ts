import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser, getServerRuntime } from "@ktb/server-fns";

/**
 * POST /api/transcribe — server-side transcription of an uploaded
 * recording via Workers AI Whisper (@cf/openai/whisper).
 *
 * The route module lives in this package and is mounted into the host's
 * virtual route tree by `consultationsRoutesPlugin`
 * (physical("/api", "src/api-routes")); the AI binding arrives through
 * the @ktb/server-fns runtime registry (host-resolved, incl. dev
 * stand-ins), so no host imports are needed (P-033).
 */
export const Route = createFileRoute("/api/transcribe")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const user = await getSessionUser();
				if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
				const form = await request.formData();
				const file = form.get("audio");
				if (!(file instanceof File)) {
					return Response.json({ error: "missing audio file" }, { status: 400 });
				}
				const ai = getServerRuntime().ai;
				if (!ai) {
					return Response.json({ error: "transcription not configured" }, { status: 503 });
				}
				const result = (await ai.run("@cf/openai/whisper", {
					audio: [...new Uint8Array(await file.arrayBuffer())],
				})) as { text?: string };
				return Response.json({ text: result.text ?? "" });
			},
		},
	},
});
