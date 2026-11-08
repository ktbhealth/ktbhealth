import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "#/lib/auth.ts";

/**
 * Same-origin CDN proxy for browser-fetched assets — the Whisper model
 * files and the onnxruntime wasm bundle. huggingface.co is unreachable
 * from some networks (and was failing mid-download for users); fetching
 * server-side keeps the bytes identical while the browser only ever talks
 * to our own origin. The upstream allowlist keeps this from being an open
 * proxy, and a session is required so it can't be abused for bandwidth.
 */
const UPSTREAMS = {
	huggingface: "https://huggingface.co/",
	jsdelivr: "https://cdn.jsdelivr.net/",
} as const;

const PASSTHROUGH_HEADERS = [
	"content-type",
	"etag",
	"accept-ranges",
	"content-range",
] as const;

async function handle({ request }: { request: Request }) {
	const user = await getSessionUser();
	if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

	const { pathname, search } = new URL(request.url);
	const rest = pathname.slice("/api/cdn/".length);
	const slash = rest.indexOf("/");
	const base =
		slash > 0 ? UPSTREAMS[rest.slice(0, slash) as keyof typeof UPSTREAMS] : undefined;
	const path = slash > 0 ? rest.slice(slash + 1) : "";
	if (!base || !path || path.includes("..")) {
		return Response.json({ error: "unknown upstream" }, { status: 404 });
	}

	const upstream = await fetch(base + path + search, {
		headers: { accept: request.headers.get("accept") ?? "*/*" },
		redirect: "follow",
	});

	const headers = new Headers();
	for (const h of PASSTHROUGH_HEADERS) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	// content-length/content-encoding are dropped: workerd fetch may have
	// already decompressed the body, which would corrupt either header.
	// Model revisions are immutable — safe to cache aggressively.
	headers.set("cache-control", "public, max-age=31536000, immutable");

	return new Response(request.method === "HEAD" ? null : upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers,
	});
}

/** /api/cdn/<upstream>/<path> — e.g. /api/cdn/huggingface/onnx-community/… */
export const Route = createFileRoute("/api/cdn/$")({
	server: {
		handlers: {
			GET: handle,
			HEAD: handle,
		},
	},
});
