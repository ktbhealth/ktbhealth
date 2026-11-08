import { fileURLToPath } from "node:url";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		// Generates src/paraglide so `#/paraglide/*` imports resolve under vitest.
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "baseLocale"],
			cookieName: "ktb-locale",
			emitTsDeclarations: true,
		}),
	],
	resolve: {
		alias: {
			"cloudflare:workers": fileURLToPath(
				new URL("./src/test/cloudflare-workers.ts", import.meta.url),
			),
		},
	},
	test: {
		include: ["src/**/*.test.*"],
		environment: "node",
	},
});
