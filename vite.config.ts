import { defineConfig } from "vite-plus";

export default defineConfig({
	defaultPackage: "./apps/web",

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
					"packages/{kernel,auth,authz,bot,captcha,transcription,anamnesis,export-pdf,ui,db,driver-framework}/**/*.{ts,tsx}",
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
								"@ktb/anamnesis-llm",
								"@ktb/anamnesis-llm/**",
								"@ktb/infra",
								"@ktb/infra/**",
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
					"packages/{kernel,auth,authz,bot,captcha,transcription,anamnesis,driver-framework}/src/**/*.ts",
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
				// `const plugin = definePlugin({...})` for host discovery.
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
				// documented client-side injection points (nova.tsx, entrar.tsx,
				// __root.tsx). Tests may mock impls freely.
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
								"@ktb/anamnesis-llm",
								"@ktb/anamnesis-llm/**",
								"@ktb/infra",
								"@ktb/infra/**",
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
				//   @ktb/app-host into the deploy target.
				// - nova.tsx injects the whisper backend client-side.
				// - entrar.tsx / __root.tsx use the better-auth client SDK,
				//   which is inherently impl-bound.
				// - *.test.* may mock impl packages.
				files: [
					"apps/web/src/lib/platform.ts",
					"apps/web/src/plugins.ts",
					"apps/web/src/routes/consulta/nova.tsx",
					"apps/web/src/routes/entrar.tsx",
					"apps/web/src/routes/__root.tsx",
					"apps/web/src/**/*.test.{ts,tsx}",
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
