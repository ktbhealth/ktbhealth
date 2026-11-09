/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

// @tanstack/router-generator evaluates the virtual route config
// (src/routes.ts) through jiti, which only enables babel's JSX/TSX
// plugins when its `jsx` option is set — the generator never passes it,
// so any .tsx reachable from routes.ts (plugin entries statically import
// their panel-page components) fails with "ParseError: Unexpected
// token" and routeTree.gen.ts is never regenerated. JITI_JSX flips
// jiti's jsx default on; it is read when jiti is created inside the
// vite process, i.e. after this module evaluates.
process.env.JITI_JSX ??= "1";

import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
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
		// Dev uses wrangler.dev.jsonc — it drops the Workers AI binding,
		// which has no local simulator and would force an authenticated
		// remote session. Build/preview keep wrangler.jsonc.
		...(process.env.VITEST
			? []
			: [
					cloudflare({
						configPath: fileURLToPath(
							new URL(
								command === "serve" && !isPreview ? "./wrangler.dev.jsonc" : "./wrangler.jsonc",
								import.meta.url,
							),
						),
						viteEnvironment: { name: "ssr" },
					}),
				]),
		devtools(),
		tailwindcss(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "baseLocale"],
			cookieName: "ktb-locale",
			emitTsDeclarations: true,
		}),
		// Custom server entry (src/server.ts) adds the Cloudflare Queue
		// consumer for async audio transcription alongside the fetch handler.
		...tanstackStart({ server: { entry: "server.ts" } }),
		viteReact(),
	],
}));
