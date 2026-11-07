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
