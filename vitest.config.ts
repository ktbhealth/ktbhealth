import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["apps/*", "packages/*"],
		coverage: {
			provider: "v8",
			enabled: true,
			reporter: ["text", "html"],
			include: ["apps/*/src/**", "packages/*/src/**"],
			exclude: [
				"**/*.test.*",
				"**/*.d.ts",
				"**/routeTree.gen.ts",
				"**/worker-configuration.d.ts",
				"**/paraglide/**",
				"packages/ui/**",
			],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
});
