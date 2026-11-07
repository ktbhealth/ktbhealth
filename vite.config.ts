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
		plugins: ["typescript", "react"],
		options: {
			typeAware: true,
			typeCheck: true,
		},
		overrides: [
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
