import { describe, expect, it, vi } from "vitest";

import { createLocalAi, resolveAi, type AiBinding } from "./ai.ts";

const binding = (): AiBinding => ({
	run: async () => ({ marker: "real" }),
});

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});

describe("resolveAi", () => {
	it("falls back to env.AI when nothing is configured", async () => {
		const real = binding();
		const ai = resolveAi({ AI: real });
		expect(ai).toBe(real);
		expect(await ai!.run("m", {})).toEqual({ marker: "real" });
	});

	it("returns undefined when no binding and no flags", () => {
		expect(resolveAi({})).toBeUndefined();
	});

	it("AI_STUB wins over env.AI and AI_BASE_URL", async () => {
		const ai = resolveAi({
			AI: binding(),
			AI_STUB: "1",
			AI_BASE_URL: "http://localhost:1",
		});
		expect(await ai!.run("@cf/x", { audio: "aGk=" })).toEqual({
			text: "[AI_STUB] stub transcription",
		});
		expect(await ai!.run("m", { messages: [] })).toEqual({ response: "{}" });
	});

	it("reads flags from process.env when absent on env", () => {
		expect(resolveAi({}, { AI_STUB: "true" })).toBeDefined();
		expect(resolveAi({}, { AI_STUB: "yes" })).toBeUndefined();
	});

	it("AI_BASE_URL beats env.AI", () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const ai = resolveAi({ AI: binding(), AI_BASE_URL: "http://localhost:8080/" }, {}, fetchImpl);
		expect(ai).toBeDefined();
		expect(ai).not.toBe(binding());
	});
});

describe("createLocalAi", () => {
	it("POSTs chat inputs to /v1/chat/completions and normalizes to {response}", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse({ choices: [{ message: { content: "hello" } }] }),
		);
		const ai = createLocalAi("http://localhost:8080/v1", fetchImpl);
		const out = await ai.run("llama", {
			messages: [{ role: "user", content: "hi" }],
			max_tokens: 10,
		});
		expect(out).toEqual({ response: "hello" });
		const [url, init] = fetchImpl.mock.calls[0]!;
		expect(url).toBe("http://localhost:8080/v1/chat/completions");
		expect(JSON.parse(init?.body as string)).toMatchObject({
			model: "llama",
			max_tokens: 10,
		});
	});

	it("POSTs audio inputs as multipart to /v1/audio/transcriptions", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ text: "olá" }));
		const ai = createLocalAi("http://localhost:8080", fetchImpl);
		const out = await ai.run("whisper", { audio: "aGk=", language: "pt" });
		expect(out).toEqual({ text: "olá" });
		const [url, init] = fetchImpl.mock.calls[0]!;
		expect(url).toBe("http://localhost:8080/v1/audio/transcriptions");
		expect(init?.body).toBeInstanceOf(FormData);
		const form = init?.body as FormData;
		expect(form.get("model")).toBe("whisper");
		expect(form.get("language")).toBe("pt");
		expect(form.get("file")).toBeInstanceOf(Blob);
	});

	it("accepts number[] audio payloads", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ text: "x" }));
		const ai = createLocalAi("http://localhost:8080", fetchImpl);
		await ai.run("whisper", { audio: [104, 105] });
		const form = fetchImpl.mock.calls[0]![1]?.body as FormData;
		const file = form.get("file") as Blob;
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([104, 105]));
	});

	it("throws on HTTP errors and unsupported inputs", async () => {
		const failing = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
		const ai = createLocalAi("http://localhost:8080", failing);
		await expect(ai.run("m", { messages: [] })).rejects.toThrow("HTTP 500");
		await expect(ai.run("m", { weird: 1 })).rejects.toThrow("unsupported inputs");
	});
});

describe("createLocalAi — payload and error edges", () => {
	const audioFile = async (audio: unknown) => {
		const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ text: "x" }));
		await createLocalAi("http://localhost:8080", fetchImpl).run("whisper", { audio });
		const form = fetchImpl.mock.calls[0]![1]?.body as FormData;
		return new Uint8Array(await (form.get("file") as Blob).arrayBuffer());
	};

	it("accepts Uint8Array audio payloads", async () => {
		expect(await audioFile(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("accepts ArrayBuffer audio payloads", async () => {
		expect(await audioFile(new Uint8Array([4, 5]).buffer)).toEqual(new Uint8Array([4, 5]));
	});

	it("rejects unsupported audio payloads", async () => {
		const ai = createLocalAi("http://localhost:8080", vi.fn<typeof fetch>());
		await expect(ai.run("whisper", { audio: 42 })).rejects.toThrow("unsupported audio payload");
	});

	it("throws on a failed transcription request", async () => {
		const failing = vi.fn<typeof fetch>(async () => new Response("nope", { status: 503 }));
		const ai = createLocalAi("http://localhost:8080", failing);
		await expect(ai.run("whisper", { audio: [1] })).rejects.toThrow(
			"local AI transcription failed: HTTP 503",
		);
	});

	it("treats null inputs as unsupported", async () => {
		const ai = createLocalAi("http://localhost:8080", vi.fn<typeof fetch>());
		await expect(ai.run("m", null)).rejects.toThrow("unsupported inputs");
	});

	it("returns an empty response when the chat completion has no choices", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
		const ai = createLocalAi("http://localhost:8080", fetchImpl);
		await expect(ai.run("m", { messages: [] })).resolves.toEqual({ response: "" });
	});

	it("omits max_tokens when it is not a number", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [] }));
		await createLocalAi("http://localhost:8080", fetchImpl).run("m", { messages: [] });
		expect(JSON.parse(fetchImpl.mock.calls[0]![1]?.body as string)).not.toHaveProperty(
			"max_tokens",
		);
	});
});
