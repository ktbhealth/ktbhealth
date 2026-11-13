import { describe, expect, it } from "vitest";

import { getLocale } from "#/paraglide/runtime.js";
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
});
