// Cloudflare Workers static assets cap at ~25 MB per file. Vite emits large
// binary assets (e.g. onnxruntime wasm) into dist/client; those are fetched
// from a CDN at runtime instead (see packages/transcription-whisper), so the
// emitted copies are dead weight that would fail deployment. Strip any asset
// over the limit and warn, so the build stays deployable.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 25_000_000; // bytes
const dirs = ["dist/client", "dist/client/assets"];

for (const dir of dirs) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		continue;
	}
	for (const e of entries) {
		if (!e.isFile()) continue;
		const p = join(dir, e.name);
		const size = statSync(p).size;
		if (size > LIMIT) {
			console.warn(`[strip-assets] removing ${p} (${(size / 1e6).toFixed(1)} MB > 25 MB)`);
			rmSync(p);
		}
	}
}
