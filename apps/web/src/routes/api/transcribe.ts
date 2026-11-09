import { createFileRoute } from "@tanstack/react-router";
import { ai } from "#/lib/platform.ts";
import { getSessionUser } from "#/lib/auth.ts";

/**
 * POST /api/transcribe — server-side transcription of an uploaded
 * recording via Workers AI Whisper (@cf/openai/whisper).
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
