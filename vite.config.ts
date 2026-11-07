import { defineConfig } from "vite-plus";

export default defineConfig({
	defaultPackage: "./apps/web",

	fmt: {
		useTabs: true,
		ignorePatterns: ["**/routeTree.gen.ts", "**/worker-configuration.d.ts"],
	},

	lint: {
		ignorePatterns: ["apps/draft-landing/alchemy.run.ts", "apps/draft-landing/infra/**"],
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
