import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Deployed to GitHub Pages as a project site: ktbhealth.github.io/ktbhealth
const base = "/ktbhealth/";

export default defineConfig({
	base,
	resolve: { tsconfigPaths: true },
	plugins: [
		tailwindcss(),
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			strategy: ["cookie", "baseLocale"],
			cookieName: "ktb-locale",
		}),
		...tanstackStart({
			router: { basepath: "/ktbhealth" },
			pages: [{ path: "/" }],
			prerender: { enabled: true, autoSubfolderIndex: true, crawlLinks: true },
		}),
		viteReact(),
	],
});
