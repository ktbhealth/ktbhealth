import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		tailwindcss(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "baseLocale"],
			cookieName: "ktb-locale",
			emitTsDeclarations: true,
		}),
		...tanstackStart({
			pages: [{ path: "/" }],
			prerender: { enabled: true, autoSubfolderIndex: true, crawlLinks: true },
		}),
		viteReact(),
	],
});
