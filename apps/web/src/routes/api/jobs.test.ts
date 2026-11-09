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

import { attachAudioRecord, createConsultation } from "@ktb/consultations";
import { auth, db } from "#/lib/platform.ts";
import { Route as JobsRoute } from "./jobs.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const get = () =>
	handlersOf(JobsRoute).GET!({
		request: new Request("http://x/api/jobs"),
	} as never);

interface Session {
	readonly cookie: string;
	readonly userId: string;
}

const sessions = new Map<string, Session>();

/** Sign up (idempotent) + sign in; sessions are cached per email. */
async function signIn(email: string, name: string): Promise<Session> {
	const cached = sessions.get(email);
	if (cached) return cached;
	await auth.api
		.signUpEmail({ body: { email, password: "senha-forte-123", name } })
		.catch(() => {});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "senha-forte-123" }),
		}),
	);
	const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	const session = { cookie, userId: sess.user.id as string };
	sessions.set(email, session);
	return session;
}

const useSession = (session: Session) => {
	headers.current = new Headers({ cookie: session.cookie });
};

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

describe("GET /api/jobs", () => {
	// PLATFORM_ADMIN_EMAILS test double allowlists this address.
	const admin = () => signIn("platform-admin@ktb.test", "Admin Jobs");

	beforeAll(async () => {
		await admin();
	});

	it("rejects unauthenticated requests", async () => {
		const saved = headers.current;
		headers.current = new Headers();
		try {
			const res = await get();
			expect(res.status).toBe(401);
		} finally {
			headers.current = saved;
		}
	});

	it("rejects non-admin sessions", async () => {
		const saved = headers.current;
		useSession(await signIn("jobs-user@x.com", "Dra Jobs"));
		try {
			const res = await get();
			expect(res.status).toBe(403);
		} finally {
			headers.current = saved;
		}
	});

	it("streams the audio-job projection as SSE frames for admins", async () => {
		const { userId } = await admin();
		useSession(await admin());
		const id = (await createConsultation(db, { userId, source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: `audio/${userId}/${id}/a.webm`, size: 3 });

		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.body).toBeTruthy();

		const buf = await readUntil(res.body!, `"id":${id},"audioStatus"`);
		expect(buf).toContain("data: ");
		expect(buf).toContain(`"audioStatus":"stored"`);
		expect(buf).toContain(": hb");
	});
});
