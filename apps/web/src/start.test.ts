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
