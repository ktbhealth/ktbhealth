import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { deployD1, deployWorker } from "@ktb/infra-cloudflare";

export default Alchemy.Stack(
	"ktb-web",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const { db } = yield* deployD1({
			name: "db",
			migrationsDir: "../../packages/db/alchemy-migrations",
		});

		// Consultation audio storage (P-015) + async transcription queue
		// (P-016). Private bucket — reads only through authenticated
		// worker routes; the queue's consumer is this same worker script.
		const audioBucket = yield* Cloudflare.R2.Bucket("audio");
		const transcriptionQueue = yield* Cloudflare.Queues.Queue("transcription");

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
					]
						.filter((k) => process.env[k])
						.map((k) => [k, Redacted.make(process.env[k] as string)]),
				),
			},
			compatibilityFlags: ["nodejs_compat"],
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
