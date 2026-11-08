import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: ["apps/web", "packages/*", "plugins/*", "infra/*"],
		coverage: {
			provider: "v8",
			enabled: true,
			reporter: ["text", "html"],
			include: ["apps/web/src/**", "packages/*/src/**", "plugins/*/src/**", "infra/*/src/**"],
			exclude: [
				"**/*.test.*",
				"**/*.d.ts",
				"**/routeTree.gen.ts",
				"**/worker-configuration.d.ts",
				"**/paraglide/**",
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
