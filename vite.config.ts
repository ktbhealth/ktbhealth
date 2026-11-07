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
					"packages/{kernel,auth,authz,bot,captcha,transcription,anamnesis,patients,consultations,export-pdf,ui,db}/**/*.{ts,tsx}",
				],
				rules: {
					"no-restricted-imports": [
						"error",
						{
							patterns: [
								"**/apps/**",
								"@ktb/web",
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
					"packages/{kernel,auth,authz,bot,captcha,transcription,anamnesis,patients,consultations}/src/**/*.ts",
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
