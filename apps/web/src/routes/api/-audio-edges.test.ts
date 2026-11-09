import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };
const flags = { noBucket: false, noQueue: false };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const chain = {
			validator: () => chain,
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg ?? {}),
		};
		return chain;
	},
}));
// The bucket/queue bindings are module constants; getters let a test hide them.
vi.mock("#/lib/platform.ts", async (importOriginal) => {
	const m = await importOriginal<typeof import("#/lib/platform.ts")>();
	return {
		...m,
		get audioBucket() {
			return flags.noBucket ? undefined : m.audioBucket;
		},
		get audioQueue() {
			return flags.noQueue ? undefined : m.audioQueue;
		},
	};
});

import { auth, db, audioQueue } from "#/lib/platform.ts";
import { consultations } from "@ktb/db/schema";
import { eq } from "drizzle-orm";
import { createConsultation } from "@ktb/consultations";
import { audioBucketStore } from "#/test/cloudflare-workers.ts";
import { Route as AudioRoute } from "./consultations.$id.audio.ts";

const handlers = (
	AudioRoute as unknown as {
		options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } };
	}
).options.server.handlers;

let cookie = "";
let userId = "";

async function signIn() {
	await auth.api.signUpEmail({
		body: { email: "audio-edges@x.com", password: "senha-forte-123", name: "Dra Edges" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "audio-edges@x.com", password: "senha-forte-123" }),
		}),
	);
	cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	userId = sess.user.id;
	headers.current = new Headers({ cookie });
}

const newConsultation = async () => (await createConsultation(db, { userId, source: "browser" }))!;

const post = (id: number | string, body: BodyInit, contentType?: string) =>
	handlers.POST!({
		request: new Request(`http://x/api/consultations/${id}/audio`, {
			method: "POST",
			headers: contentType ? { "content-type": contentType, cookie } : { cookie },
			body,
		}),
		params: { id: String(id) },
	} as never);

const get = (id: number | string) => handlers.GET!({ params: { id: String(id) } } as never);

const rowOf = async (id: number) =>
	(await db.select().from(consultations).where(eq(consultations.id, id)))[0]!;

beforeAll(signIn);

afterEach(() => {
	flags.noBucket = false;
	flags.noQueue = false;
	vi.restoreAllMocks();
});

describe("audio upload edge cases", () => {
	it("answers 503 when the bucket or the queue is not configured", async () => {
		const id = await newConsultation();
		flags.noBucket = true;
		expect((await post(id, new Uint8Array([1]), "audio/webm")).status).toBe(503);
		flags.noBucket = false;
		flags.noQueue = true;
		const res = await post(id, new Uint8Array([1]), "audio/webm");
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "audio storage not configured" });
	});

	it("rejects a multipart form without an audio file", async () => {
		const id = await newConsultation();
		const form = new FormData();
		form.set("audio", "not-a-file");
		const res = await post(id, form);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "missing audio file" });
	});

	it("rejects a multipart file without a media type (falls back to the form content type)", async () => {
		const id = await newConsultation();
		// Some runtimes hand back a File with an empty type; make that explicit.
		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1, 2])], "rec", { type: "" }));
		const request = new Request(`http://x/api/consultations/${id}/audio`, {
			method: "POST",
			headers: { "content-type": "multipart/form-data; boundary=b", cookie },
		});
		request.formData = async () => form;
		const res = await handlers.POST!({ request, params: { id: String(id) } } as never);
		expect(res.status).toBe(415);
	});

	it("rejects non-audio content types", async () => {
		const id = await newConsultation();
		const res = await post(id, "hello", "text/plain");
		expect(res.status).toBe(415);
		expect(await res.json()).toEqual({ error: "unsupported content type" });
	});

	it("rejects uploads over the size limit", async () => {
		const id = await newConsultation();
		const res = await post(id, new Uint8Array(50 * 1024 * 1024 + 1), "audio/webm");
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({ error: "audio too large" });
	});

	it("stores a body without a content type as an opaque .bin object", async () => {
		const id = await newConsultation();
		const res = await post(id, new Uint8Array([1, 2, 3]));
		expect(res.status).toBe(200);
		const row = await rowOf(id);
		expect(row.audioKey).toMatch(/\.bin$/);
		expect(row.audioContentType).toBeNull();
		expect(audioBucketStore.get(row.audioKey!)?.contentType).toBe("application/octet-stream");
	});

	it("accepts application/octet-stream and unknown audio types", async () => {
		const a = await newConsultation();
		expect((await post(a, new Uint8Array([1]), "application/octet-stream")).status).toBe(200);
		const b = await newConsultation();
		expect((await post(b, new Uint8Array([1]), "audio/aac")).status).toBe(200);
		expect((await rowOf(b)).audioKey).toMatch(/\.bin$/);
	});

	it("reports 502 when the audio is stored but the queue is down", async () => {
		const id = await newConsultation();
		vi.spyOn(audioQueue!, "send").mockRejectedValueOnce(new Error("queue down"));
		const res = await post(id, new Uint8Array([1]), "audio/webm");
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: "audio stored but transcription queue unavailable",
		});
		expect((await rowOf(id)).audioStatus).toBe("stored");
	});
});

describe("audio download edge cases", () => {
	const withAudio = async (stored?: { contentType?: string }, rowType: string | null = null) => {
		const id = await newConsultation();
		const audioKey = `audio/${userId}/${id}/fixture.bin`;
		if (stored) audioBucketStore.set(audioKey, { data: new Uint8Array([7, 7]), ...stored });
		await db
			.update(consultations)
			.set({ audioKey, audioContentType: rowType })
			.where(eq(consultations.id, id));
		return id;
	};

	it("answers 503 when the bucket is not configured", async () => {
		const id = await newConsultation();
		flags.noBucket = true;
		expect((await get(id)).status).toBe(503);
	});

	it("answers 404 for a non-numeric id", async () => {
		expect((await get("abc")).status).toBe(404);
	});

	it("answers 404 when the row points at a missing object", async () => {
		const id = await withAudio(undefined);
		expect((await get(id)).status).toBe(404);
	});

	it("falls back to the stored object's content type, then to octet-stream", async () => {
		const typed = await withAudio({ contentType: "audio/ogg" });
		expect((await get(typed)).headers.get("content-type")).toBe("audio/ogg");
		const untyped = await withAudio({});
		expect((await get(untyped)).headers.get("content-type")).toBe("application/octet-stream");
	});

	it("prefers the content type recorded on the row", async () => {
		const id = await withAudio({ contentType: "audio/ogg" }, "audio/mp4");
		expect((await get(id)).headers.get("content-type")).toBe("audio/mp4");
	});
});
