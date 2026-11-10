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

// Optimized-entry filenames inside node_modules/.vite/deps_ssr (dev SSR only).
const SSR_REACT_ENTRIES: Record<string, string> = {
	react: "react.js",
	"react/jsx-runtime": "react_jsx-runtime.js",
	"react/jsx-dev-runtime": "react_jsx-dev-runtime.js",
	"react-dom": "react-dom.js",
	"react-dom/server": "react-dom_server.js",
};

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
				resolve: {
					// @tanstack/react-start force-externalizes @tanstack/react-router
					// in the ssr env (see its configEnvironment hook). Externalized
					// modules are imported natively by workerd, so react-router's
					// `react` import resolves to the raw CJS react.development.js —
					// a second React instance whose dispatcher is null while
					// react-dom/server (pre-bundled in deps_ssr) renders with the
					// bundled copy → "Invalid hook call". Listing it in noExternal
					// makes the plugin drop resolve.external for it, so the router
					// goes through the Vite pipeline.
					noExternal: ["@tanstack/react-router", "@tanstack/react-router-devtools"],
				},
			},
		},
		// See environments.ssr.resolve above and the "ktb:ssr-single-react"
		// plugin below — together they keep dev SSR on a single React instance.
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
			// @tanstack/react-start's configEnvironment hook adds @tanstack/react-router
			// and react-router-devtools to environments.ssr.optimizeDeps.exclude.
			// Under @cloudflare/vite-plugin the ssr env runs with
			// resolve.noExternal: true + optimizeDeps.noDiscovery: false, i.e. the
			// whole SSR graph is meant to be served through Vite — excluded
			// packages instead fall back to raw ?v= files whose react imports
			// resolve to a second React copy. configEnvironment results are merged
			// (arrays concat), so the entries can only be dropped by mutating the
			// env options in place; this plugin is listed after tanstackStart() so
			// its hook runs after the TanStack one. (@tanstack/react-start and
			// @tanstack/start-static-server-functions must stay excluded: they
			// import virtual #tanstack-*-entry specifiers the dep optimizer cannot
			// resolve.)
			{
				name: "ktb:ssr-single-react",
				configEnvironment(name, options) {
					if (name !== "ssr") return;
					const exclude = options.optimizeDeps?.exclude;
					if (!Array.isArray(exclude)) return;
					for (const dep of ["@tanstack/react-router", "@tanstack/react-router-devtools"]) {
						const index = exclude.indexOf(dep);
						if (index !== -1) exclude.splice(index, 1);
					}
				},
			},
			{
				// enforce:"pre" so this wins over vite:resolve for the pinned
				// specifiers; kept separate from the configEnvironment plugin
				// above because enforce would reorder that hook before
				// TanStack's.
				name: "ktb:ssr-single-react-pin",
				enforce: "pre",
				applyToEnvironment(environment) {
					return environment.name === "ssr";
				},
				// Imports of react & friends from inside node_modules (raw ?v
				// modules and deps_ssr chunks alike) skip dep optimization and
				// resolve to the raw CJS files — a second React instance whose
				// dispatcher is null while the bundled react-dom/server renders.
				// Pin every specifier to the optimized entry in deps_ssr so the
				// whole SSR graph shares one React. The resolved path sits inside
				// the deps dir, so isOptimizedDepFile still matches and the
				// ?v= version query + CJS named-export interop keep working.
				// Dev-only: deps_ssr does not exist for build/preview.
				resolveId(source) {
					// Workerd dev SSR only — not build/preview, not vitest, not
					// KTB_DEV_NODE (plain Node resolves React fine on its own).
					if (command !== "serve" || isPreview || process.env.VITEST || nodeDev) return;
					const file = SSR_REACT_ENTRIES[source];
					if (file) {
						return fileURLToPath(new URL(`./node_modules/.vite/deps_ssr/${file}`, import.meta.url));
					}
				},
			},
			viteReact(),
		],
	};
});
