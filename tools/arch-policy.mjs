/**
 * Architecture boundary policy — the single source of truth for where
 * platform/provider APIs are allowed.
 *
 * Consumed by:
 * - vite.config.ts `lint.overrides` — generates the oxlint
 *   no-restricted-imports / no-restricted-globals entries below.
 * - tools/ktb-arch-plugin.js — the `provider-lockin` rule scans string
 *   literals in port/domain files against PROVIDER_LITERAL_PATTERNS.
 *
 * Port/domain code (PORT_GLOBS) must stay runtime- and provider-agnostic:
 * config arrives through ports/layers, never through platform APIs or
 * provider-named literals. Adapters, the composition root (apps/*,
 * infra/*, @ktb/app-host) and tests are the edge and may use them.
 *
 * To grant an exception, add the file to EDGE_FILES or move its package
 * out of PORT_PACKAGE_NAMES — do not weaken a rule inline.
 */

/** Port/domain packages — the same set banned from importing adapters. */
const PORT_PACKAGE_NAMES = [
	"kernel",
	"auth",
	"authz",
	"bot",
	"captcha",
	"transcription",
	"anamnesis",
	"export-pdf",
	"interop",
	"db",
	"driver-framework",
	// Tenancy ports/helpers — platform capability, not an adapter.
	"tenant",
	"rbac",
	// The server-fn runtime registry is port infrastructure, not an adapter.
	"server-fns",
];

const pkgGlob = (names) => `packages/{${names.join(",")}}/src/**/*.{ts,tsx}`;

/** Files held to the strict boundary: ports, domain packages, plugins. */
export const PORT_GLOBS = [pkgGlob(PORT_PACKAGE_NAMES), "plugins/**/*.{ts,tsx}"];

/** Test files inside the strict boundary — relaxed by the test override
 * in vite.config.ts (Node APIs and impl mocks are fine in tests). */
export const PORT_TEST_GLOBS = [
	`packages/{${PORT_PACKAGE_NAMES.join(",")}}/src/**/*.test.{ts,tsx}`,
	"plugins/**/*.test.{ts,tsx}",
];

/** Import specifiers that tie code to a runtime or cloud platform. */
export const PLATFORM_IMPORT_PATTERNS = ["node:*", "bun:*", "deno:*", "cloudflare:*", "workerd:*"];

/** Globals that only exist on specific runtimes. */
export const PLATFORM_GLOBALS = ["process", "Bun", "Deno"];

/**
 * String literals that name a provider — model ids, endpoints, product
 * prefixes. Domain code must not hardcode these; they belong in adapters
 * or deploy config. Extend this list when a new provider leaks in.
 */
export const PROVIDER_LITERAL_PATTERNS = [
	/^@cf\//, // Cloudflare Workers AI model ids
	/\bapi\.anthropic\.com\b/,
	/\bapi\.openai\.com\b/,
];

/** Adapter packages — implementations of ports, allowed platform APIs
 * and provider literals by definition. Banned from *importing* each
 * other and from being imported by ports/plugins (IMPL_IMPORT_PATTERNS
 * below). Listed here so the boundary is explicit. */
const ADAPTER_PACKAGE_NAMES = [
	"auth-better",
	"bot-recall",
	"captcha-stub",
	"captcha-turnstile",
	"anamnesis-llm",
	"interop-fhir",
	"interop-openehr",
	"transcription-whisper",
	"transcription-webspeech",
	"db-sqlite",
];

/**
 * Import specifiers port/domain files may never use: the deploy target,
 * the composition root, infra adapters and every adapter package.
 * Tests keep these bans; only the platform/runtime patterns are relaxed
 * for them (see the test override in vite.config.ts).
 */
export const IMPL_IMPORT_PATTERNS = [
	"**/apps/**",
	"@ktb/web",
	"@ktb/app-host",
	"@ktb/app-host/**",
	"@ktb/infra-cloudflare",
	"@ktb/infra-cloudflare/**",
	"cloudflare:*",
	...ADAPTER_PACKAGE_NAMES.flatMap((name) => [`@ktb/${name}`, `@ktb/${name}/**`]),
];
