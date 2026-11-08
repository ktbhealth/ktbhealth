import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

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

import { auth, db } from "#/lib/platform.ts";
import { consultations } from "@ktb/db/schema";
import { eq } from "drizzle-orm";
import { createConsultation } from "@ktb/consultations";
import { audioBucketStore, audioQueueSent } from "#/test/cloudflare-workers.ts";
import { Route as AudioRoute } from "./consultations.$id.audio.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

let cookie = "";
let userId = "";

async function signIn() {
	await auth.api.signUpEmail({
		body: { email: "audio@x.com", password: "senha-forte-123", name: "Dra Audio" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "audio@x.com", password: "senha-forte-123" }),
		}),
	);
	cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	userId = sess.user.id;
	headers.current = new Headers({ cookie });
}

const audioPost = (id: number | string, body: BodyInit, contentType?: string) =>
	new Request(`http://x/api/consultations/${id}/audio`, {
		method: "POST",
		headers: contentType ? { "content-type": contentType, cookie } : { cookie },
		body,
	});

describe("consultation audio routes", () => {
	beforeAll(signIn);

	it("rejects unauthenticated upload and download", async () => {
		const h = handlersOf(AudioRoute);
		const saved = headers.current;
		headers.current = new Headers();
		try {
			const up = await h.POST!({
				request: audioPost(1, new Uint8Array([1]), "audio/webm"),
				params: { id: "1" },
			} as never);
			expect(up.status).toBe(401);
			const down = await h.GET!({ params: { id: "1" } } as never);
			expect(down.status).toBe(401);
		} finally {
			headers.current = saved;
		}
	});

	it("uploads raw audio to R2, links the row and enqueues the job", async () => {
		const h = handlersOf(AudioRoute);
		const id = (await createConsultation(db, { userId, source: "browser" }))!;
		const bytes = new Uint8Array([9, 8, 7, 6]);
		const res = await h.POST!({
			request: audioPost(id, bytes, "audio/webm"),
			params: { id: String(id) },
		} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, audioStatus: "queued", audioSize: 4 });

		const rows = await db.select().from(consultations).where(eq(consultations.id, id));
		const row = rows[0]!;
		expect(row.audioStatus).toBe("queued");
		expect(row.audioKey).toMatch(new RegExp(`^audio/${userId}/${id}/.*\\.webm$`));
		expect(row.audioContentType).toBe("audio/webm");
		expect(row.audioSize).toBe(4);
		expect(audioBucketStore.has(row.audioKey!)).toBe(true);
		expect(audioQueueSent.at(-1)).toMatchObject({
			consultationId: id,
			audioKey: row.audioKey,
			userId,
		});
	});

	it("accepts multipart audio file uploads", async () => {
		const h = handlersOf(AudioRoute);
		const id = (await createConsultation(db, { userId, source: "browser" }))!;
		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1, 2])], "rec.ogg", { type: "audio/ogg" }));
		const res = await h.POST!({
			request: new Request(`http://x/api/consultations/${id}/audio`, {
				method: "POST",
				headers: { cookie },
				body: form,
			}),
			params: { id: String(id) },
		} as never);
		expect(res.status).toBe(200);
	});

	it("rejects bad ids, empty bodies and foreign consultations", async () => {
		const h = handlersOf(AudioRoute);
		const bad = await h.POST!({
			request: audioPost("abc", new Uint8Array([1]), "audio/webm"),
			params: { id: "abc" },
		} as never);
		expect(bad.status).toBe(404);

		const id = (await createConsultation(db, { userId, source: "browser" }))!;
		const empty = await h.POST!({
			request: audioPost(id, new Uint8Array(0), "audio/webm"),
			params: { id: String(id) },
		} as never);
		expect(empty.status).toBe(400);

		const foreign = await createConsultation(db, { userId: "someone-else", source: "browser" });
		const denied = await h.POST!({
			request: audioPost(foreign!, new Uint8Array([1]), "audio/webm"),
			params: { id: String(foreign) },
		} as never);
		expect(denied.status).toBe(404);
	});

	it("streams stored audio back to the owner only", async () => {
		const h = handlersOf(AudioRoute);
		const id = (await createConsultation(db, { userId, source: "browser" }))!;
		const bytes = new Uint8Array([5, 4, 3, 2, 1]);
		await h.POST!({
			request: audioPost(id, bytes, "audio/webm"),
			params: { id: String(id) },
		} as never);

		const res = await h.GET!({ params: { id: String(id) } } as never);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("audio/webm");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

		// Another user's consultation → 404 (same as missing).
		const foreign = (await createConsultation(db, { userId: "other@x.com", source: "browser" }))!;
		const denied = await h.GET!({ params: { id: String(foreign) } } as never);
		expect(denied.status).toBe(404);

		// Consultation without audio → 404.
		const noAudio = (await createConsultation(db, { userId, source: "browser" }))!;
		const missing = await h.GET!({ params: { id: String(noAudio) } } as never);
		expect(missing.status).toBe(404);
	});
});
