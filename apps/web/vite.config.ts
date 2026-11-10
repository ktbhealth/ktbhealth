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

export default defineConfig(({ command, isPreview }) => {
	// KTB_DEV_NODE=1 (`bun run dev:node`): run the dev server on plain
	// Node/Bun instead of workerd — no cloudflare plugin, and
	// `cloudflare:workers` is aliased to a process.env + SQLite-file shim
	// (src/lib/node-cloudflare-workers.ts). DB then comes from
	// DATABASE_URL (default ./data/app.db) via @ktb/db-sqlite instead of
	// the local D1 binding. Build/preview are unaffected.
	const nodeDev =
		process.env.KTB_DEV_NODE === "1" && command === "serve" && !isPreview && !process.env.VITEST;
	return {
		resolve: {
			tsconfigPaths: true,
			dedupe: ["react", "react-dom"],
			alias: [
				...(nodeDev
					? [
							{
								find: "cloudflare:workers",
								replacement: fileURLToPath(
									new URL("./src/lib/node-cloudflare-workers.ts", import.meta.url),
								),
							},
						]
					: []),
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
		environments: {
			ssr: {
				optimizeDeps: {
					// pdfkit is only reachable through lazily-mounted server route
					// modules, so the SSR dep crawler misses it on cold start.
					// Discovering it mid-request forces a second optimizer pass +
					// program reload, during which react-router's raw-transformed
					// source resolves `react` to the raw CJS build while
					// react-dom/server uses the bundled one (invalid hook call).
					// Pre-bundling keeps the first pass complete — no reload.
					include: ["pdfkit"],
				},
			},
		},
		worker: { format: "es" },
		test: {
			include: ["src/**/*.test.*"],
			exclude: ["e2e/**"],
		},
		plugins: [
			// workerd everywhere except vitest (unit tests stay on plain Node)
			// and KTB_DEV_NODE dev (plain Node + SQLite file instead of D1).
			// Dev uses wrangler.dev.jsonc — it drops the Workers AI binding,
			// which has no local simulator and would force an authenticated
			// remote session. Build/preview keep wrangler.jsonc.
			...(process.env.VITEST || nodeDev
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
	};
});
