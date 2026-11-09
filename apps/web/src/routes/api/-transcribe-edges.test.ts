import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };
const ai = vi.hoisted(() => ({
	current: undefined as { run: (m: string, i: unknown) => Promise<unknown> } | undefined,
}));

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("#/lib/platform.ts", async (importOriginal) => {
	const m = await importOriginal<typeof import("#/lib/platform.ts")>();
	return {
		...m,
		get ai() {
			return ai.current;
		},
	};
});

import { auth } from "#/lib/platform.ts";
import { Route as TranscribeRoute } from "./transcribe.ts";

const POST = (
	TranscribeRoute as unknown as {
		options: { server: { handlers: { POST: (a: never) => Promise<Response> } } };
	}
).options.server.handlers.POST;

const upload = () => {
	const form = new FormData();
	form.set("audio", new File([new Uint8Array([1, 2, 3])], "rec.webm", { type: "audio/webm" }));
	return POST({
		request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
	} as never);
};

beforeAll(async () => {
	await auth.api.signUpEmail({
		body: { email: "transcribe-edges@x.com", password: "senha-forte-123", name: "Dra T" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "transcribe-edges@x.com", password: "senha-forte-123" }),
		}),
	);
	headers.current = new Headers({ cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! });
});

afterEach(() => {
	ai.current = undefined;
});

describe("/api/transcribe edge cases", () => {
	it("answers 503 when Workers AI is not bound", async () => {
		const res = await upload();
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "transcription not configured" });
	});

	it("returns an empty text when the model answers without one", async () => {
		ai.current = { run: vi.fn(async () => ({})) };
		const res = await upload();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ text: "" });
		expect(ai.current.run).toHaveBeenCalledWith("@cf/openai/whisper", { audio: [1, 2, 3] });
	});

	it("returns the model's text", async () => {
		ai.current = { run: async () => ({ text: "olá mundo" }) };
		const res = await upload();
		expect(await res.json()).toEqual({ text: "olá mundo" });
	});
});
