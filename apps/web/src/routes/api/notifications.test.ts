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

import { insertNotification } from "@ktb/notifications";
import { db } from "#/lib/platform.ts";
import { auth } from "#/lib/platform.ts";
import { Route as NotificationsRoute } from "./notifications.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

let cookie = "";
let userId = "";

async function signIn() {
	await auth.api.signUpEmail({
		body: { email: "sse@x.com", password: "senha-forte-123", name: "Dra SSE" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "sse@x.com", password: "senha-forte-123" }),
		}),
	);
	cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	userId = sess.user.id;
	headers.current = new Headers({ cookie });
}

/** Read SSE frames until `needle` shows up or the deadline passes. */
async function readUntil(body: ReadableStream<Uint8Array>, needle: string, ms = 8000) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	const deadline = Date.now() + ms;
	try {
		while (!buf.includes(needle) && Date.now() < deadline) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return buf;
}

describe("GET /api/notifications", () => {
	beforeAll(signIn);

	it("rejects unauthenticated requests", async () => {
		const saved = headers.current;
		headers.current = new Headers();
		try {
			const h = handlersOf(NotificationsRoute);
			const res = await h.GET!({
				request: new Request("http://x/api/notifications"),
			} as never);
			expect(res.status).toBe(401);
		} finally {
			headers.current = saved;
		}
	});

	it("streams the persisted backlog as SSE frames plus heartbeats", async () => {
		await insertNotification(db, {
			userId,
			kind: "test.ping",
			title: "SSE backlog ping",
		});
		const h = handlersOf(NotificationsRoute);
		const res = await h.GET!({
			request: new Request("http://x/api/notifications", {
				headers: { cookie },
			}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.body).toBeTruthy();

		const buf = await readUntil(res.body!, "SSE backlog ping");
		expect(buf).toContain("data: ");
		expect(buf).toContain('"title":"SSE backlog ping"');
		expect(buf).toContain('"read":false');
		// Stream.tick emits a heartbeat immediately, then every 25s — the
		// first `: hb` comment should already be in the buffer.
		expect(buf).toContain(": hb");
	});
});
