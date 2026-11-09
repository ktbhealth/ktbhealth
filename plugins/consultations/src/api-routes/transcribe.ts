import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser, getServerRuntime } from "@ktb/server-fns";

/**
 * POST /api/transcribe — server-side transcription of an uploaded
 * recording via Workers AI Whisper.
 *
 * The route module lives in this package and is mounted into the host's
 * virtual route tree by `consultationsRoutesPlugin`
 * (physical("/api", "src/api-routes")); the AI binding arrives through
 * the @ktb/server-fns runtime registry (host-resolved, incl. dev
 * stand-ins), so no host imports are needed (P-033).
 */

/**
 * Workers AI rejects oversized audio and chunked transcription is not
 * supported — keep in sync with MAX_AUDIO_BYTES in
 * apps/web/src/lib/audio-jobs.ts, which enforces the same ceiling on
 * the queued pipeline.
 */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Model + payload shape shared with the queue pipeline (audio-jobs.ts):
 * whisper-large-v3-turbo takes base64 audio, not a number[] byte array —
 * a 25MB number[] would serialize to a ~100MB JSON body. */
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** btoa without stack overflow on large buffers (chunked fromCharCode). */
const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
};

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
				if (file.size === 0) {
					return Response.json({ error: "empty audio file" }, { status: 400 });
				}
				if (file.size > MAX_AUDIO_BYTES) {
					return Response.json(
						{ error: "audio too large for transcription (max 25MB)" },
						{ status: 413 },
					);
				}
				// Same acceptance rule as the audio upload route: audio/* or
				// an opaque/octet-stream payload; anything else is rejected.
				const mediaType = (file.type || "application/octet-stream")
					.split(";")[0]!
					.trim()
					.toLowerCase();
				if (!mediaType.startsWith("audio/") && mediaType !== "application/octet-stream") {
					return Response.json({ error: "unsupported content type" }, { status: 415 });
				}
				const ai = getServerRuntime().ai;
				if (!ai) {
					return Response.json({ error: "transcription not configured" }, { status: 503 });
				}
				const bytes = new Uint8Array(await file.arrayBuffer());
				const result = (await ai.run(WHISPER_MODEL, {
					audio: bytesToBase64(bytes),
					language: "pt",
				})) as { text?: string };
				return Response.json({ text: result.text ?? "" });
			},
		},
	},
});
