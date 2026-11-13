import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { deploySqlDatabase, deployWorker } from "@ktb/infra-cloudflare";

export default Alchemy.Stack(
	"ktb-web",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const { db } = yield* deploySqlDatabase({
			name: "db",
			migrationsDir: "../../packages/db/alchemy-migrations",
		});

		// Consultation audio storage (P-015) + async transcription queue
		// (P-016). Private bucket — reads only through authenticated
		// worker routes; the queue's consumer is this same worker script.
		const audioBucket = yield* Cloudflare.R2.Bucket("audio");
		const transcriptionQueue = yield* Cloudflare.Queues.Queue("transcription");

		// Prod defaults to the self-hosted LGTM collector behind the CF
		// tunnel (P-066/P-067, infra/lgtm → ktb-otel.luisfuturist.com); an
		// explicit OTEL_EXPORTER_OTLP_ENDPOINT always wins so local or
		// staging collectors can be targeted without code changes.
		// `Stage` is the alchemy-provided service — ALCHEMY_STAGE is NOT
		// set in process.env inside the stack program.
		const stage = yield* Alchemy.Stage;
		const otelEndpoint =
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
			(stage === "prod" ? "https://ktb-otel.luisfuturist.com" : undefined);
		const ktbEnvironment =
			process.env.KTB_ENVIRONMENT ?? (stage === "prod" ? "production" : undefined);

		const site = yield* deployWorker({
			name: "web",
			outdir: "dist/client",
			main: "dist/server/index.js",
			bundle: false,
			bindings: {
				DB: db,
				AI: Cloudflare.Workers.AI(),
				AUDIO_BUCKET: audioBucket,
				AUDIO_QUEUE: transcriptionQueue,
				...(process.env.BETTER_AUTH_SECRET
					? { BETTER_AUTH_SECRET: Redacted.make(process.env.BETTER_AUTH_SECRET) }
					: {}),
				// Public base URL better-auth builds callback/reset links
				// from — config, not a secret (cuora ref: better-auth-url).
				...(process.env.BETTER_AUTH_URL ? { BETTER_AUTH_URL: process.env.BETTER_AUTH_URL } : {}),
				...(process.env.TURNSTILE_SECRET_KEY
					? { TURNSTILE_SECRET_KEY: Redacted.make(process.env.TURNSTILE_SECRET_KEY) }
					: {}),
				// LLM provider config — bound as worker vars/secrets so
				// createApp's env mapping reaches them in production.
				...Object.fromEntries(
					[
						"ANTHROPIC_API_KEY",
						"LLM_API_KEY",
						"OPENAI_API_KEY",
						"LLM_BASE_URL",
						"LLM_MODEL",
						"WORKERS_AI_MODEL",
						"RECALL_API_KEY",
					]
						.filter((k) => process.env[k])
						.map((k) => [k, Redacted.make(process.env[k] as string)]),
				),
				// /platform console admin allowlist (P-026) — plain config,
				// not a secret, but bound the same way for parity.
				...(process.env.PLATFORM_ADMIN_EMAILS
					? { PLATFORM_ADMIN_EMAILS: process.env.PLATFORM_ADMIN_EMAILS }
					: {}),
				// Server-side transcription model override (plain config).
				...(process.env.AUDIO_TRANSCRIBE_MODEL
					? { AUDIO_TRANSCRIBE_MODEL: process.env.AUDIO_TRANSCRIBE_MODEL }
					: {}),
				// Observability (T-099): OTLP collector config — endpoint and
				// service name are plain config; headers + scrape token are
				// secrets. Unset everywhere → console/Prometheus fallback.
				...(otelEndpoint ? { OTEL_EXPORTER_OTLP_ENDPOINT: otelEndpoint } : {}),
				...(process.env.OTEL_EXPORTER_OTLP_HEADERS
					? {
							OTEL_EXPORTER_OTLP_HEADERS: Redacted.make(process.env.OTEL_EXPORTER_OTLP_HEADERS),
						}
					: {}),
				...(process.env.OTEL_SERVICE_NAME
					? { OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME }
					: {}),
				...(ktbEnvironment ? { KTB_ENVIRONMENT: ktbEnvironment } : {}),
				...(process.env.KTB_TELEMETRY_TRACES_SAMPLE_RATE
					? { KTB_TELEMETRY_TRACES_SAMPLE_RATE: process.env.KTB_TELEMETRY_TRACES_SAMPLE_RATE }
					: {}),
				...(process.env.KTB_TELEMETRY_CLIENT_SAMPLE_RATE
					? {
							KTB_TELEMETRY_CLIENT_SAMPLE_RATE: process.env.KTB_TELEMETRY_CLIENT_SAMPLE_RATE,
						}
					: {}),
				...(process.env.OTEL_SDK_DISABLED
					? { OTEL_SDK_DISABLED: process.env.OTEL_SDK_DISABLED }
					: {}),
				...(process.env.METRICS_SCRAPE_TOKEN
					? { METRICS_SCRAPE_TOKEN: Redacted.make(process.env.METRICS_SCRAPE_TOKEN) }
					: {}),
				// Remaining ObservabilityEnv knobs — all plain config. Per-
				// signal endpoints matter because the TLS guard drops remote
				// http:// URLs; compression/resource-attributes/tuning vars
				// are optional but must be bindable to reach the worker.
				...Object.fromEntries(
					[
						"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
						"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
						"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
						"OTEL_EXPORTER_OTLP_COMPRESSION",
						"OTEL_RESOURCE_ATTRIBUTES",
						"KTB_TELEMETRY_EXPORT_INTERVAL_MS",
						"KTB_TELEMETRY_MAX_BATCH_SIZE",
						"KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS",
						"KTB_TELEMETRY_CLIENT",
						"KTB_LOG_LEVEL",
					]
						.filter((k) => process.env[k])
						.map((k) => [k, process.env[k] as string]),
				),
			},
			// No nodejs_compat: worker-runtime code reads secrets only via
			// bindings (.dev.vars in dev, these bindings in prod).
		});

		// Queue consumer → this worker's `queue` handler (src/server.ts).
		// scriptName may be an unresolved Output — Alchemy Input accepts it.
		if (site.scriptName) {
			yield* Cloudflare.Queues.Consumer("transcription-consumer", {
				queueId: transcriptionQueue.queueId,
				scriptName: site.scriptName as string,
				settings: { maxRetries: 3 },
			});
		}

		return { url: site.url };
	}),
);
