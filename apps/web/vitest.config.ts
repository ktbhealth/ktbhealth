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
			// Node stand-in for the sockets contract — lets platform.ts's
			// `cloudflare:sockets` import resolve under plain-Node vitest.
			"cloudflare:sockets": fileURLToPath(
				new URL("../../packages/email-smtp/src/node-connect.ts", import.meta.url),
			),
		},
	},
	test: {
		include: ["src/**/*.test.*"],
		environment: "node",
	},
});
