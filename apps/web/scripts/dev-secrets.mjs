// `dev:secrets` entrypoint: cuora injects the vault secrets into
// process.env, we persist the worker-binding subset to apps/web/.dev.vars
// (miniflare/wrangler loads it as worker vars+secrets automatically), then
// spawn `vp dev` with the same env so Vite still sees VITE_* vars and the
// developer shell keeps its exports. No nodejs_compat needed: the worker
// reads secrets exclusively through bindings.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Must be present — the app cannot boot auth/captcha without them.
const REQUIRED = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "TURNSTILE_SECRET_KEY"];

// Optional config/secrets passed through when set, so e.g.
// `AI_STUB=1 bun run dev:secrets` or a cuora-provided LLM key keeps working.
// VITE_TURNSTILE_SITE_KEY is deliberately absent: the Turnstile widget reads
// it client-side via import.meta.env, which Vite resolves from the spawned
// process env — it is not a worker binding.
const OPTIONAL = [
	"AI_STUB",
	"AI_BASE_URL",
	"ANTHROPIC_API_KEY",
	"LLM_API_KEY",
	"OPENAI_API_KEY",
	"LLM_BASE_URL",
	"LLM_MODEL",
	"WORKERS_AI_MODEL",
	"RECALL_API_KEY",
	"PLATFORM_ADMIN_EMAILS",
	"AUDIO_TRANSCRIBE_MODEL",
	"CAPTCHA_STUB",
	// Telemetry config — mirrors OBSERVABILITY_ENV_KEYS in
	// @ktb/observability (config.ts); keep in sync. These are optional
	// OTEL_*/KTB_* vars so `OTEL_EXPORTER_OTLP_ENDPOINT=… bun run
	// dev:secrets` reaches the workerd bindings via .dev.vars.
	"OTEL_SDK_DISABLED",
	"OTEL_SERVICE_NAME",
	"OTEL_RESOURCE_ATTRIBUTES",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
	"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_EXPORTER_OTLP_COMPRESSION",
	"KTB_ENVIRONMENT",
	"KTB_TELEMETRY_TRACES_SAMPLE_RATE",
	"KTB_TELEMETRY_EXPORT_INTERVAL_MS",
	"KTB_TELEMETRY_MAX_BATCH_SIZE",
	"KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS",
	"KTB_TELEMETRY_CLIENT",
	"KTB_TELEMETRY_CLIENT_SAMPLE_RATE",
	"KTB_TELEMETRY_RATE_LIMIT_PER_IP",
	"KTB_TELEMETRY_RATE_LIMIT_GLOBAL",
	"KTB_LOG_LEVEL",
];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
	console.error(
		`dev-secrets: missing required env vars: ${missing.join(", ")}\n` +
			"Run via `bun run dev:secrets` (cuora run) so the vault secrets are injected.",
	);
	process.exit(1);
}

const keys = [...REQUIRED, ...OPTIONAL.filter((key) => process.env[key])];
// dotenv-style: double-quote values so secrets with spaces/# survive parsing.
const lines = keys.map((key) => `${key}=${JSON.stringify(process.env[key])}`);
writeFileSync(join(root, ".dev.vars"), `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`dev-secrets: wrote .dev.vars (${keys.length} bindings)`);

const child = spawn("vp", ["dev", "--port", "3000"], {
	cwd: root,
	env: process.env,
	stdio: "inherit",
});
child.on("error", (err) => {
	console.error(`dev-secrets: failed to spawn vp: ${err.message}`);
	process.exit(1);
});
child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 1);
});
