declare namespace Cloudflare {
	interface Env {
		BETTER_AUTH_SECRET?: string;
		BETTER_AUTH_URL?: string;
		TURNSTILE_SECRET_KEY?: string;
		CAPTCHA_STUB?: string;
		/** Recall.ai bot provider API key (bot-recall driver). */
		RECALL_API_KEY?: string;
		/** Comma-separated admin allowlist for the /platform console (P-026). */
		PLATFORM_ADMIN_EMAILS?: string;
		/** R2 bucket for consultation audio (P-015). */
		AUDIO_BUCKET?: R2Bucket;
		/** Queue producer for async transcription jobs (P-016). */
		AUDIO_QUEUE?: Queue;
	}
}
