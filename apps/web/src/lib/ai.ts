/**
 * AI binding resolution for local dev — precedence:
 * AI_STUB > AI_BASE_URL > env.AI (the Workers AI binding).
 *
 * The `ai` binding has no local simulator, so wrangler dev routes it
 * through a remote session that requires Cloudflare auth. Dev uses
 * wrangler.dev.jsonc (no `ai` binding); this module supplies stand-ins:
 *
 * - AI_STUB=1: canned responses — no server needed, deterministic.
 * - AI_BASE_URL=http://localhost:8080/v1: OpenAI-compatible server
 *   (whisper.cpp, llama.cpp, LM Studio…) — same convention as
 *   LLM_BASE_URL. Audio inputs POST to <base>/audio/transcriptions,
 *   chat inputs to <base>/chat/completions.
 * - otherwise the real env.AI binding (prod, or `wrangler dev` with
 *   the full wrangler.jsonc).
 */

export interface AiBinding {
	run(model: string, inputs: unknown): Promise<unknown>;
}

export interface AiEnv {
	readonly AI?: AiBinding;
	readonly AI_STUB?: unknown;
	readonly AI_BASE_URL?: unknown;
}

const enabled = (value: unknown): boolean => value === true || value === "1" || value === "true";

const stubAi: AiBinding = {
	run: async (_model, inputs) => {
		const i = inputs as Record<string, unknown> | null;
		if (i !== null && typeof i === "object" && "audio" in i) {
			return { text: "[AI_STUB] stub transcription" };
		}
		// Chat-shaped inputs (anamnesis extraction/cleanup) get an empty
		// JSON object — downstream drivers fall back to heuristics.
		return { response: "{}" };
	},
};

/** Accepts base64 string (queue + /api/transcribe path), number[] (legacy), bytes. */
const audioToBytes = (audio: unknown): Uint8Array<ArrayBuffer> => {
	if (typeof audio === "string") {
		const binary = atob(audio);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}
	// Copy so the result is always backed by a plain ArrayBuffer (BlobPart).
	if (audio instanceof Uint8Array) return new Uint8Array(audio);
	if (audio instanceof ArrayBuffer) return new Uint8Array(audio);
	if (Array.isArray(audio)) return Uint8Array.from(audio as number[]);
	throw new Error("local AI: unsupported audio payload");
};

/** OpenAI-compatible HTTP backend (whisper.cpp, llama.cpp, LM Studio). */
export const createLocalAi = (baseUrl: string, fetchImpl: typeof fetch = fetch): AiBinding => ({
	run: async (model, inputs) => {
		const i = (inputs ?? {}) as Record<string, unknown>;
		// Accept the base with or without the /v1 suffix (LLM_BASE_URL
		// convention includes it; bare host roots are common too).
		const base = `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
		if ("audio" in i) {
			const form = new FormData();
			form.set("model", model);
			form.set("file", new Blob([audioToBytes(i.audio)]), "audio.wav");
			if (typeof i.language === "string") form.set("language", i.language);
			const res = await fetchImpl(`${base}/audio/transcriptions`, {
				method: "POST",
				body: form,
			});
			if (!res.ok) throw new Error(`local AI transcription failed: HTTP ${res.status}`);
			return res.json();
		}
		if (Array.isArray(i.messages)) {
			const res = await fetchImpl(`${base}/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model,
					messages: i.messages,
					...(typeof i.max_tokens === "number" ? { max_tokens: i.max_tokens } : {}),
				}),
			});
			if (!res.ok) throw new Error(`local AI chat failed: HTTP ${res.status}`);
			const json = (await res.json()) as {
				choices?: { message?: { content?: string } }[];
			};
			return { response: json.choices?.[0]?.message?.content ?? "" };
		}
		throw new Error("local AI: unsupported inputs");
	},
});

export const resolveAi = (
	env: AiEnv,
	procEnv: Record<string, string | undefined> = {},
	fetchImpl: typeof fetch = fetch,
): AiBinding | undefined => {
	if (enabled(env.AI_STUB ?? procEnv.AI_STUB)) return stubAi;
	const baseUrl = env.AI_BASE_URL ?? procEnv.AI_BASE_URL;
	if (typeof baseUrl === "string" && baseUrl !== "") {
		return createLocalAi(baseUrl, fetchImpl);
	}
	return env.AI;
};
