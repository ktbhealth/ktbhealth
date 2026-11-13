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
		/** Observability (T-099): OTLP endpoint, e.g. https://otlp.example.com. */
		OTEL_EXPORTER_OTLP_ENDPOINT?: string;
		/** OTLP auth headers, e.g. "Authorization=Bearer x" (secret). */
		OTEL_EXPORTER_OTLP_HEADERS?: string;
		/** Service name reported to the collector. */
		OTEL_SERVICE_NAME?: string;
		/** Deployment environment tag (production/staging/…). */
		KTB_ENVIRONMENT?: string;
		/** Trace sample ratio 0..1 (default 1). */
		KTB_TELEMETRY_TRACES_SAMPLE_RATE?: string;
		/** Client-event sample ratio 0..1 (default 1). */
		KTB_TELEMETRY_CLIENT_SAMPLE_RATE?: string;
		/** Per-signal OTLP endpoint overrides (full /v1/<signal> URL). */
		OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?: string;
		OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
		OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string;
		/** "gzip" enables OTLP request compression. */
		OTEL_EXPORTER_OTLP_COMPRESSION?: string;
		/** Extra OTLP resource attributes, k=v,k2=v2. */
		OTEL_RESOURCE_ATTRIBUTES?: string;
		/** OTLP export interval / batch / shutdown tuning (ms, counts). */
		KTB_TELEMETRY_EXPORT_INTERVAL_MS?: string;
		KTB_TELEMETRY_MAX_BATCH_SIZE?: string;
		KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS?: string;
		/** "0"/"false" disables browser-event ingest. */
		KTB_TELEMETRY_CLIENT?: string;
		/** Minimum Effect log level (Info/Warning/…). */
		KTB_LOG_LEVEL?: string;
		/** "1" disables all telemetry export. */
		OTEL_SDK_DISABLED?: string;
		/** Bearer token guarding GET /api/metrics (secret). */
		METRICS_SCRAPE_TOKEN?: string;
	}
}
