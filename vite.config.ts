import { defineConfig } from "vite-plus";

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
				// Port/domain packages may never reach into adapter implementations
				// or platform APIs. Composition roots (apps/*, @ktb/db schema
				// aggregation) are the only places allowed to wire impls.
				files: [
					"packages/{kernel,auth,authz,bot,captcha,transcription,anamnesis,export-pdf,interop,ui,db,driver-framework}/**/*.{ts,tsx}",
					"plugins/**/*.{ts,tsx}",
				],
				rules: {
					"no-restricted-imports": [
						"error",
						{
							patterns: [
								"**/apps/**",
								"@ktb/web",
								"@ktb/app-host",
								"@ktb/app-host/**",
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
								"@ktb/infra-cloudflare",
								"@ktb/infra-cloudflare/**",
								"cloudflare:*",
							],
						},
					],
				},
			},
			{
				// Env access is adapter-only: domain code receives config
				// through ports/layers, never process.env.
				files: [
					"packages/{kernel,auth,authz,bot,captcha,transcription,anamnesis,interop,driver-framework}/src/**/*.ts",
					"plugins/*/src/**/*.ts",
				],
				rules: {
					"no-restricted-globals": [
						"error",
						{
							name: "process",
							message: "process is adapter-only; inject config via ports/layers",
						},
					],
				},
			},
			{
				// Plugin entry contract: every plugin must export
				// `plugins` — an array of `definePlugin({...})` entries —
				// for host discovery.
				files: ["plugins/*/src/index.ts"],
				rules: {
					"ktb-arch/plugin-contract": "error",
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
