import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig(({ command }) => ({
	resolve: { tsconfigPaths: true },
	// Whisper worker imports this lazily; pre-bundle it at startup so the
	// dev server doesn't re-optimize (and 504) while the worker is loading.
	optimizeDeps: { include: ["@huggingface/transformers"] },
	worker: { format: "es" },
	plugins: [
		// workerd runtime only for build/deploy: better-sqlite3 can't load in
		// workerd, so dev/tests stay on Node SSR until the db moves to D1.
		...(command === "build" ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
		devtools(),
		tailwindcss(),
		...tanstackStart(),
		viteReact(),
	],
}));

export default config;
