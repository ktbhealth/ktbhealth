import { createFileRoute } from "@tanstack/react-router";
import { ai } from "#/lib/platform.ts";

/**
 * POST /api/transcribe — server-side transcription of an uploaded
 * recording via Workers AI Whisper (@cf/openai/whisper).
 */
export const Route = createFileRoute("/api/transcribe")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const form = await request.formData();
				const file = form.get("audio");
				if (!(file instanceof File)) {
					return Response.json({ error: "missing audio file" }, { status: 400 });
				}
				const result = await ai.run("@cf/openai/whisper", {
					audio: [...new Uint8Array(await file.arrayBuffer())],
				});
				return Response.json({ text: result.text });
			},
		},
	},
});
