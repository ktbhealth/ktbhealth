/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		dedupe: ["react", "react-dom"],
		alias: [
			{
				// CJS-only package; breaks workerd SSR. React 19 has the hook.
				find: /^use-sync-external-store\/shim$/,
				replacement: fileURLToPath(
					new URL("./src/lib/use-sync-external-store-shim.ts", import.meta.url),
				),
			},
			{
				find: /^use-sync-external-store\/shim\/with-selector$/,
				replacement: fileURLToPath(
					new URL("./src/lib/use-sync-external-store-shim-with-selector.ts", import.meta.url),
				),
			},
		],
	},
	// Whisper worker imports this lazily; pre-bundle it at startup so the
	// dev server doesn't re-optimize (and 504) while the worker is loading.
	optimizeDeps: { include: ["@huggingface/transformers"] },
	worker: { format: "es" },
	test: {
		include: ["src/**/*.test.*"],
		exclude: ["e2e/**"],
	},
	plugins: [
		// workerd everywhere except vitest (unit tests stay on plain Node).
		...(process.env.VITEST ? [] : [cloudflare({ viteEnvironment: { name: "ssr" } })]),
		devtools(),
		tailwindcss(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "baseLocale"],
			cookieName: "ktb-locale",
			emitTsDeclarations: true,
		}),
		...tanstackStart(),
		viteReact(),
	],
});

export default config;
