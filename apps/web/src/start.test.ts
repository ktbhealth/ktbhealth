import { describe, expect, it, vi } from "vitest";

import { getLocale } from "#/paraglide/runtime.js";
import { setAccessLogSink } from "#/lib/access-log.ts";
import { startInstance } from "./start.ts";

type ServerFn = (options: {
	request: Request;
	pathname: string;
	context: Record<string, never>;
	next: () => unknown;
	handlerType: "router";
}) => Promise<{ response: Response }>;

async function runMiddleware(cookie?: string) {
	const options = await startInstance.getOptions();
	const server = options.requestMiddleware![0].options.server as unknown as ServerFn;
	expect(server).toBeTypeOf("function");
	let localeInsideNext: string | undefined;
	const request = new Request("http://localhost/consultations", {
		headers: cookie ? { cookie } : {},
	});
	const result = await server({
		request,
		pathname: "/consultations",
		context: {},
		handlerType: "router",
		next: () => {
			localeInsideNext = getLocale();
			return {
				request,
				pathname: "/consultations",
				context: {},
				response: new Response("ok"),
			};
		},
	});
	return { localeInsideNext, response: result.response };
}

describe("locale request middleware", () => {
	it("resolves getLocale() from the ktb-locale cookie during the request", async () => {
		const { localeInsideNext, response } = await runMiddleware("ktb-locale=pt-BR");
		expect(localeInsideNext).toBe("pt-BR");
		expect(response.status).toBe(200);
	});

	it("falls back to the base locale without a cookie", async () => {
		const { localeInsideNext } = await runMiddleware();
		expect(localeInsideNext).toBe("en");
	});
});

describe("telemetry request middleware", () => {
	type ServerOptions = {
		request: Request;
		pathname: string;
		context: Record<string, never>;
		next: () => unknown;
		handlerType: "router" | "serverFn";
	};
	type ServerFn = (options: ServerOptions) => Promise<{ response: Response }>;

	const middleware = async () => {
		const options = await startInstance.getOptions();
		return options.requestMiddleware![1].options.server as unknown as ServerFn;
	};

	const run = async (
		request: Request,
		respond: () => unknown = () => ({
			request,
			pathname: "/x",
			context: {},
			response: new Response("ok", { status: 201 }),
		}),
	) => {
		const server = await middleware();
		return server({
			request,
			pathname: "/x",
			context: {},
			handlerType: "router",
			next: respond,
		});
	};

	it("echoes inbound correlation headers and records the request", async () => {
		const request = new Request("http://localhost/x", {
			headers: {
				"x-request-id": "rid-1",
				traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
			},
		});
		const result = await run(request);
		expect(result.response.status).toBe(201);
		expect(result.response.headers.get("x-request-id")).toBe("rid-1");
		expect(result.response.headers.get("x-traceparent")).toBe(
			"00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
		);
	});

	it("generates a request id when none is inbound", async () => {
		const result = await run(new Request("http://localhost/x"));
		const id = result.response.headers.get("x-request-id");
		expect(id).toBeTruthy();
		expect(result.response.headers.get("x-traceparent")).toBeNull();
	});

	it("unwraps SSR-style response wrappers for headers", async () => {
		const inner = new Response("ssr", { status: 200 });
		const result = await run(new Request("http://localhost/x"), () => ({
			request: new Request("http://localhost/x"),
			pathname: "/x",
			context: {},
			response: { response: inner },
		}));
		expect(inner.headers.get("x-request-id")).toBeTruthy();
		expect(result.response).toBeDefined();
	});

	it("tolerates results without a Response", async () => {
		const result = await run(new Request("http://localhost/x"), () => ({
			request: new Request("http://localhost/x"),
			pathname: "/x",
			context: {},
			response: "not-a-response",
		}));
		expect(result.response).toBe("not-a-response");
	});

	it("replaces malformed correlation headers with fresh values", async () => {
		const request = new Request("http://localhost/x", {
			headers: {
				"x-request-id": "bad id with spaces",
				traceparent: "not-a-traceparent",
			},
		});
		const result = await run(request);
		const echoed = result.response.headers.get("x-request-id");
		expect(echoed).toBeTruthy();
		expect(echoed).not.toBe("bad id with spaces");
		expect(result.response.headers.get("x-traceparent")).toBeNull();
	});

	it("records metrics and an access log with status 500 when next() throws", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const request = new Request("http://localhost/x", {
			headers: { "x-request-id": "rid-throw" },
		});
		const failure = new Error("handler exploded");
		await expect(run(request, () => Promise.reject(failure))).rejects.toBe(failure);
		const line = info.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.find((l: string) => l.includes("http.access"));
		expect(line).toBeDefined();
		expect(JSON.parse(line!)).toMatchObject({
			message: "http.access",
			status: 500,
			requestId: "rid-throw",
		});
		vi.restoreAllMocks();
	});

	it("emits an http.access record with request context", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const request = new Request("http://localhost/x", {
			headers: {
				"x-request-id": "rid-9",
				traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
			},
		});
		await run(request);
		const line = info.mock.calls
			.map((c: unknown[]) => String(c[0]))
			.find((l: string) => l.includes("http.access"));
		expect(line).toBeDefined();
		expect(JSON.parse(line!)).toMatchObject({
			message: "http.access",
			method: "GET",
			path: "/x",
			status: 201,
			handlerType: "router",
			requestId: "rid-9",
			traceId: "0af7651916cd43dd8448eb211c80319c",
		});
		vi.restoreAllMocks();
	});

	it("routes the access record through the registered sink when present", async () => {
		const sink = vi.fn().mockResolvedValue(undefined);
		setAccessLogSink(sink);
		try {
			const info = vi.spyOn(console, "info").mockImplementation(() => {});
			const request = new Request("http://localhost/x", {
				headers: { "x-request-id": "rid-sink" },
			});
			await run(request);
			expect(sink).toHaveBeenCalledTimes(1);
			expect(sink.mock.calls[0]![0]).toMatchObject({
				method: "GET",
				path: "/x",
				status: 201,
				requestId: "rid-sink",
			});
			expect(
				info.mock.calls.map((c: unknown[]) => String(c[0])).some((l) => l.includes("http.access")),
			).toBe(false);
		} finally {
			setAccessLogSink(undefined);
			vi.restoreAllMocks();
		}
	});
});
