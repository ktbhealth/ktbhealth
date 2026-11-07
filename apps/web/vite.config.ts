/// <reference types="vitest/config" />
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	// Whisper worker imports this lazily; pre-bundle it at startup so the
	// dev server doesn't re-optimize (and 504) while the worker is loading.
	optimizeDeps: { include: ["@huggingface/transformers"] },
	worker: { format: "es" },
	test: {
		include: ["src/**/*.test.*"],
		exclude: ["e2e/**"],
		coverage: {
			provider: "v8",
			enabled: true,
			reporter: ["text", "html"],
			include: ["src/**"],
			exclude: [
				"src/**/*.test.*",
				"src/**/*.d.ts",
				"src/routeTree.gen.ts",
				"**/worker-configuration.d.ts",
			],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
	plugins: [
		// workerd everywhere except vitest (unit tests stay on plain Node).
		...(process.env.VITEST ? [] : [cloudflare({ viteEnvironment: { name: "ssr" } })]),
		devtools(),
		tailwindcss(),
		...tanstackStart(),
		viteReact(),
	],
});

export default config;
