import { afterEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock("#/lib/auth.ts", () => ({ getSessionUser }));

import { Route } from "./$.ts";

type Handler = (a: { request: Request }) => Promise<Response>;
const handlers = (
	Route as unknown as { options: { server: { handlers: Record<string, Handler> } } }
).options.server.handlers;

const call = (method: "GET" | "HEAD", url: string, init?: RequestInit) =>
	handlers[method]!({ request: new Request(url, { method, ...init }) });

const upstream = (body: string | null, init?: ResponseInit) =>
	new Response(body, { status: 200, ...init });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("/api/cdn proxy", () => {
	it("serves GET and HEAD through the same handler", () => {
		expect(handlers.GET).toBe(handlers.HEAD);
	});

	it("rejects anonymous visitors", async () => {
		getSessionUser.mockResolvedValue(null);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await call("GET", "http://x/api/cdn/huggingface/a/b.onnx");
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		["no upstream segment", "http://x/api/cdn/huggingface"],
		["unknown upstream", "http://x/api/cdn/evil/a/b"],
		["empty path", "http://x/api/cdn/huggingface/"],
		["double dots in the path", "http://x/api/cdn/huggingface/a..b"],
	])("returns 404 for %s", async (_name, url) => {
		getSessionUser.mockResolvedValue({ id: "u1" });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const res = await call("GET", url);
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: "unknown upstream" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("proxies an allowlisted upstream, forwarding accept and the query string", async () => {
		getSessionUser.mockResolvedValue({ id: "u1" });
		const fetchMock = vi.fn(async () =>
			upstream("model-bytes", {
				headers: {
					"content-type": "application/octet-stream",
					etag: '"abc"',
					"content-length": "11",
					"set-cookie": "leak=1",
				},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const res = await call("GET", "http://x/api/cdn/huggingface/org/model/file.onnx?download=1", {
			headers: { accept: "application/octet-stream" },
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"https://huggingface.co/org/model/file.onnx?download=1",
			{
				headers: { accept: "application/octet-stream" },
				redirect: "follow",
			},
		);
		expect(res.status).toBe(200);
		await expect(res.text()).resolves.toBe("model-bytes");
		expect(res.headers.get("content-type")).toBe("application/octet-stream");
		expect(res.headers.get("etag")).toBe('"abc"');
		expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	it("defaults accept to */* and supports the jsdelivr upstream", async () => {
		getSessionUser.mockResolvedValue({ id: "u1" });
		const fetchMock = vi.fn(async () => upstream("wasm"));
		vi.stubGlobal("fetch", fetchMock);
		await call("GET", "http://x/api/cdn/jsdelivr/npm/onnxruntime-web/dist/ort.wasm");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.wasm",
			{ headers: { accept: "*/*" }, redirect: "follow" },
		);
	});

	it("drops the body for HEAD and keeps the upstream status", async () => {
		getSessionUser.mockResolvedValue({ id: "u1" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => upstream(null, { status: 206, statusText: "Partial Content" })),
		);
		const res = await call("HEAD", "http://x/api/cdn/huggingface/a/b");
		expect(res.status).toBe(206);
		expect(res.statusText).toBe("Partial Content");
		await expect(res.text()).resolves.toBe("");
	});
});
