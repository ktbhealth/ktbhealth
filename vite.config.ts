import { defineConfig } from "vite-plus";
import {
	IMPL_IMPORT_PATTERNS,
	PLATFORM_GLOBALS,
	PLATFORM_IMPORT_PATTERNS,
	PORT_GLOBS,
	PORT_TEST_GLOBS,
} from "./tools/arch-policy.mjs";

export default defineConfig({
	defaultPackage: "./apps/web",

	// Task runner (`vp run`). CI tasks are prefixed `ci:` because a task cannot
	// share a name with a package.json script. `vp build` generates the
	// paraglide output (src/paraglide, gitignored) that the type-aware lint
	// in `check` and the tests import, so both depend on it; results are
	// cached and restored on a hit.
	run: {
		tasks: {
			"ci:build": { command: "vp build" },
			"ci:check": { command: "vp check", dependsOn: ["ci:build"] },
			"ci:test": { command: "vp test", dependsOn: ["ci:build"] },
			// Regenerate plugins/*/src/route-types.d.ts from the freshly
			// generated routeTree.gen.ts (ci:build) and fail on drift.
			// `git add -N` surfaces newly created files in `git diff`.
			"ci:route-types": {
				command: "bun run gen:route-types && git add -N plugins && git diff --exit-code -- plugins",
				dependsOn: ["ci:build"],
			},
			// Unused-code/dependency gate (knip.json is the config).
			"ci:knip": { command: "bun run knip" },
			// Fast smoke test proving the ktb-arch rules still fire
			// (tools/check-arch.mjs) — no build or lint run needed.
			"ci:arch": { command: "bun run check:arch" },
		},
	},

	fmt: {
		useTabs: true,
		ignorePatterns: [
			"**/routeTree.gen.ts",
			"**/worker-configuration.d.ts",
			"**/.alchemy/**",
			"**/drizzle/meta/**",
			"**/coverage/**",
			// Agent/tool-managed skill installs — not repo source.
			".agents/**",
			".claude/**",
			"skills-lock.json",
		],
	},

	lint: {
		plugins: ["typescript", "react", "import"],
		// ktb architecture rules (tools/ktb-arch-plugin.js), enabled per-glob
		// in the overrides below.
		jsPlugins: [{ name: "ktb-arch", specifier: "./tools/ktb-arch-plugin.js" }],
		options: {
			typeAware: true,
			typeCheck: true,
		},
		overrides: [
			{
				files: ["packages/**/*.ts", "packages/**/*.tsx"],
				rules: {
					"no-restricted-imports": ["error", { patterns: ["**/apps/**", "@ktb/web"] }],
					"import/no-cycle": "error",
					"import/no-self-import": "error",
				},
			},
			{
				// Port/domain boundary (tools/arch-policy.mjs is the source of
				// truth): ports, domain packages and plugins may never reach
				// into adapter implementations, the deploy target, the
				// composition root, or runtime/cloud platform APIs
				// (node:*, bun:*, deno:*, cloudflare:*, workerd:*, process,
				// Bun, Deno). Provider-named literals (@cf/* model ids,
				// provider endpoints) are banned by ktb-arch/provider-lockin.
				// Composition roots (apps/*, infra/*, @ktb/app-host) and
				// adapters are the edge and exempt by construction.
				files: PORT_GLOBS,
				rules: {
					"no-restricted-imports": [
						"error",
						{ patterns: [...IMPL_IMPORT_PATTERNS, ...PLATFORM_IMPORT_PATTERNS] },
					],
					"no-restricted-globals": [
						"error",
						...PLATFORM_GLOBALS.map((name) => ({
							name,
							message: `${name} is runtime-specific; inject config via ports/layers`,
						})),
					],
					"ktb-arch/provider-lockin": "error",
				},
			},
			{
				// Tests run on Node and may mock/wire impls freely: they keep
				// the adapter-import bans but are exempt from platform-API
				// and provider-literal rules.
				files: PORT_TEST_GLOBS,
				rules: {
					"no-restricted-imports": ["error", { patterns: IMPL_IMPORT_PATTERNS }],
					"no-restricted-globals": "off",
					"ktb-arch/provider-lockin": "off",
				},
			},
			{
				// Plugin entry contract: every plugin must export
				// `plugins` — an array of `definePlugin({...})` entries —
				// for host discovery (server index.ts and client.ts alike).
				files: ["plugins/*/src/index.ts", "plugins/*/src/client.ts"],
				rules: {
					"ktb-arch/plugin-contract": "error",
				},
			},
			{
				// Client manifests ship to the browser bundle: value
				// imports are allowlisted (kernel, UI kit, React/lucide/
				// router primitives, relative .tsx components) so server
				// modules (index.ts entries, api/fns/schema, db, cqrs,
				// server-fns, effect) can never leak into the client graph.
				files: ["plugins/*/src/client.ts"],
				rules: {
					"ktb-arch/client-contract": "error",
				},
			},
			{
				// Driver descriptors must stay typed against the framework port.
				files: ["packages/**/*.ts", "plugins/**/*.ts"],
				rules: {
					"ktb-arch/driver-contract": "error",
				},
			},
			{
				// Deploy-target code consumes ports and domain packages only;
				// impl adapters are wired exclusively in the composition root
				// (lib/platform.ts, lib/plugins.ts — excepted below) and in
				// documented client-side injection points (new.tsx,
				// whisper-prefetch.ts, login.tsx, __root.tsx). Tests may mock
				// impls freely.
				files: ["apps/web/src/{lib,components,routes}/**/*.{ts,tsx}"],
				rules: {
					"no-restricted-imports": [
						"error",
						{
							patterns: [
								"@ktb/auth-better",
								"@ktb/auth-better/**",
								"@ktb/bot-recall",
								"@ktb/bot-recall/**",
								"@ktb/captcha-stub",
								"@ktb/captcha-stub/**",
								"@ktb/captcha-turnstile",
								"@ktb/captcha-turnstile/**",
								"@ktb/transcription-whisper",
								"@ktb/transcription-whisper/**",
								"@ktb/transcription-webspeech",
								"@ktb/transcription-webspeech/**",
								"@ktb/anamnesis-llm",
								"@ktb/anamnesis-llm/**",
								"@ktb/interop-fhir",
								"@ktb/interop-fhir/**",
								"@ktb/interop-openehr",
								"@ktb/interop-openehr/**",
								"@ktb/db-sqlite",
								"@ktb/db-sqlite/**",
								"@ktb/infra-cloudflare",
								"@ktb/infra-cloudflare/**",
								"@ktb/app-host",
								"@ktb/app-host/**",
							],
						},
					],
				},
			},
			{
				// Documented exceptions to the impl-import ban above:
				// - platform.ts / plugins.ts are the composition root wiring
				//   @ktb/app-host (and the @ktb/interop-* exporters) into the
				//   deploy target.
				// - node-cloudflare-workers.ts is the KTB_DEV_NODE env shim —
				//   it is the composition root for the plain-Node dev target
				//   and wires @ktb/db-sqlite as AppEnv.DB.
				// - consultations plugin modules inject the transcription
				//   backend client-side (backend.ts resolves the driver;
				//   routes/new.tsx + routes/index.tsx consume it) and warm
				//   the model on consultations pages (whisper-prefetch.ts)
				//   — the same documented injection points the host route
				//   files had before the P-033 route migration.
				// - login.tsx / __root.tsx / platform.tsx use the better-auth
				//   client SDK, which is inherently impl-bound.
				// - *.test.* may mock impl packages.
				files: [
					"apps/web/src/lib/platform.ts",
					"apps/web/src/lib/node-cloudflare-workers.ts",
					"apps/web/src/plugins.ts",
					"apps/web/src/routes/login.tsx",
					"apps/web/src/routes/__root.tsx",
					"apps/web/src/routes/platform.tsx",
					"apps/web/src/**/*.test.{ts,tsx}",
					"plugins/consultations/src/routes/new.tsx",
					"plugins/consultations/src/backend.ts",
					"plugins/consultations/src/whisper-prefetch.ts",
					"plugins/consultations/src/whisper-prefetch.test.ts",
					// api-routes.test.ts wires the real @ktb/interop-* exporters
					// into the server-fns runtime — same role platform.ts plays
					// in the host (tests may mock/wire impls freely).
					"plugins/consultations/src/api-routes.test.ts",
				],
				rules: {
					"no-restricted-imports": "off",
				},
			},
			{
				files: ["**/*.test.ts", "**/*.test.tsx"],
				plugins: ["vitest"],
			},
			{
				files: ["packages/**"],
				env: { node: true },
			},
		],
	},
});
