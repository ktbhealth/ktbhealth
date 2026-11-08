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

let failCreateConsultation = false;
vi.mock("@ktb/consultations", async (importOriginal) => {
	const m = await importOriginal<typeof import("@ktb/consultations")>();
	const { Effect, Layer } = await import("effect");
	// Wrap the real layer so `create` can be forced to fail in tests; the
	// service methods are reached through `run`, not module exports.
	const ConsultationsLive = Layer.effect(
		m.Consultations,
		Effect.gen(function* () {
			const svc = yield* Effect.provide(m.Consultations, m.ConsultationsLive);
			return m.Consultations.of({
				...svc,
				create: (fields: Parameters<typeof svc.create>[0]) =>
					failCreateConsultation ? Effect.succeed(null) : svc.create(fields),
			});
		}),
	);
	return {
		...m,
		ConsultationsLive,
		// app-host composes plugin.services, not the named export.
		plugin: { ...m.plugin, services: ConsultationsLive },
	};
});

import { auth, db } from "#/lib/platform.ts";
import { consultations } from "@ktb/db/schema";
import { eq } from "drizzle-orm";
import { Route as AuthRoute } from "./auth.$.ts";
import { Route as BotsRoute } from "./bots.ts";
import { Route as WebhookRoute } from "./bots.webhook.ts";
import { Route as PdfRoute } from "./consultations.$id.pdf.ts";
import { Route as TranscribeRoute } from "./transcribe.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

const post = (url: string, body: unknown) =>
	new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

let cookie = "";
let userId = "";

async function signIn() {
	await auth.api.signUpEmail({
		body: { email: "api@x.com", password: "senha-forte-123", name: "Dra API" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "api@x.com", password: "senha-forte-123" }),
		}),
	);
	cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	userId = sess.user.id;
	headers.current = new Headers({ cookie });
}

describe("api routes", () => {
	beforeAll(signIn);

	it("auth catch-all proxies GET and POST", async () => {
		const h = handlersOf(AuthRoute);
		const get = await h.GET!({
			request: new Request("http://localhost:3000/api/auth/get-session", {
				headers: { cookie },
			}),
		} as never);
		expect(get.status).toBe(200);
		const res = await h.POST!({
			request: post("http://localhost:3000/api/auth/sign-in/email", {
				email: "api@x.com",
				password: "senha-forte-123",
			}),
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { email: string } };
		expect(body.user.email).toBe("api@x.com");
	});

	it("transcribe rejects unauthenticated requests", async () => {
		const h = handlersOf(TranscribeRoute);
		const saved = headers.current;
		headers.current = new Headers();
		try {
			const form = new FormData();
			form.set("audio", new File([new Uint8Array([1, 2, 3])], "a.wav"));
			const res = await h.POST!({
				request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
			} as never);
			expect(res.status).toBe(401);
		} finally {
			headers.current = saved;
		}
	});

	it("transcribe requires an audio file and returns text", async () => {
		const h = handlersOf(TranscribeRoute);
		const empty = await h.POST!({
			request: new Request("http://x/api/transcribe", { method: "POST", body: new FormData() }),
		} as never);
		expect(empty.status).toBe(400);

		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1, 2, 3])], "a.wav"));
		const res = await h.POST!({
			request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
		} as never);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ text: "transcrição do servidor" });
	});

	it("bots POST creates a stub consultation", { timeout: 25000 }, async () => {
		const h = handlersOf(BotsRoute);
		const bad = await h.POST!({
			request: post("http://x/api/bots", {}),
		} as never);
		expect(bad.status).toBe(400);

		failCreateConsultation = true;
		const failed = await h.POST!({
			request: post("http://x/api/bots", { meetUrl: "https://meet.google.com/fail-1234" }),
		} as never);
		expect(failed.status).toBe(500);
		failCreateConsultation = false;

		const res = await h.POST!({
			request: post("http://x/api/bots", { meetUrl: "https://meet.google.com/abc-defg-hij" }),
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { consultationId: number; botId: string; provider: string };
		expect(body.provider).toBe("stub");
		expect(body.consultationId).toBeGreaterThan(0);
		// wait for the simulated call to finish appending
		await vi.waitFor(
			async () => {
				const rows = await db
					.select()
					.from(consultations)
					.where(eq(consultations.id, body.consultationId));
				expect(rows[0]?.status).toBe("done");
			},
			{ timeout: 20000 },
		);
	});

	it("bots POST requires auth", async () => {
		headers.current = new Headers();
		const h = handlersOf(BotsRoute);
		await expect(
			h.POST!({ request: post("http://x/api/bots", { meetUrl: "https://m.co/x" }) } as never),
		).rejects.toThrow("unauthenticated");
		headers.current = new Headers({ cookie });
	});

	it("webhook validates, authorizes and appends transcript", async () => {
		const h = handlersOf(WebhookRoute);
		const bad = await h.POST!({
			request: post("http://x/api/bots/webhook", {}),
		} as never);
		expect(bad.status).toBe(400);

		// create a bot consultation directly
		const { createConsultation } = await import("@ktb/consultations");
		const id = await createConsultation(db, {
			userId,
			source: "bot",
			status: "live",
			botId: "bot-123",
		});
		expect(id).toBeGreaterThan(0);

		const forbidden = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "wrong-bot",
				text: "oi",
			}),
		} as never);
		expect(forbidden.status).toBe(403);

		const seg = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
				speaker: "Médico",
				text: "Bom dia",
			}),
		} as never);
		expect(seg.status).toBe(200);

		const noText = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
			}),
		} as never);
		expect(noText.status).toBe(200);

		const noSpeaker = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
				text: "linha sem locutor",
			}),
		} as never);
		expect(noSpeaker.status).toBe(200);

		const end = await h.POST!({
			request: post("http://x/api/bots/webhook", {
				consultationId: id,
				botId: "bot-123",
				end: true,
			}),
		} as never);
		expect(end.status).toBe(200);

		const rows = await db.select().from(consultations).where(eq(consultations.id, id));
		expect(rows[0]?.transcript).toContain("Médico: Bom dia");
		expect(rows[0]?.transcript).toContain("linha sem locutor");
		expect(rows[0]?.status).toBe("done");
	});

	it("pdf route serves owner PDF and rejects others", async () => {
		const h = handlersOf(PdfRoute);
		const missing = await h.GET!({ params: { id: "99999" } } as never);
		expect(missing.status).toBe(404);
		const badId = await h.GET!({ params: { id: "abc" } } as never);
		expect(badId.status).toBe(404);
		headers.current = new Headers();
		const anon = await h.GET!({ params: { id: "1" } } as never);
		expect(anon.status).toBe(404);
		headers.current = new Headers({ cookie });

		// consultation without anamnesis → 409
		const { createConsultation } = await import("@ktb/consultations");
		const id = await createConsultation(db, { userId, source: "mic" });
		const noAnamnesis = await h.GET!({ params: { id: String(id) } } as never);
		expect(noAnamnesis.status).toBe(409);

		// with anamnesis → PDF bytes (full schema-valid anamnesis)
		const sec = { content: "x", confidence: "alta", evidence: [] };
		await db
			.update(consultations)
			.set({
				anamnesis: JSON.stringify({
					queixa_principal: sec,
					hda: sec,
					antecedentes: sec,
					alergias: sec,
					medicamentos_em_uso: sec,
					exame_fisico: sec,
					hipoteses: sec,
					conduta: sec,
				}),
			})
			.where(eq(consultations.id, id));
		const pdf = await h.GET!({ params: { id: String(id) } } as never);
		expect(pdf.status).toBe(200);
		expect(pdf.headers.get("content-type")).toBe("application/pdf");
		const bytes = new Uint8Array(await pdf.arrayBuffer());
		expect(bytes.length).toBeGreaterThan(100);
	});

	it("pdf route returns 404 for another user's consultation", async () => {
		const h = handlersOf(PdfRoute);
		const { createConsultation } = await import("@ktb/consultations");
		const id = await createConsultation(db, { userId, source: "mic" });

		// Second user → service fails Forbidden → mapped to 404.
		await auth.api.signUpEmail({
			body: { email: "api2@x.com", password: "senha-forte-123", name: "Dra Dois" },
		});
		const res = await auth.handler(
			new Request("http://localhost:3000/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "api2@x.com", password: "senha-forte-123" }),
			}),
		);
		headers.current = new Headers({
			cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
		});
		const denied = await h.GET!({ params: { id: String(id) } } as never);
		expect(denied.status).toBe(404);
		headers.current = new Headers({ cookie });
	});
});
