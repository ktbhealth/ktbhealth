import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

import { SAMPLE_TRANSCRIPT, type Anamnesis, type AnamnesisSection } from "@ktb/anamnesis";
import { auth, db } from "./platform.ts";
import { consultations } from "@ktb/db/schema";
import {
	attachAnamnesisFn,
	createPatientFn,
	extractAnamnesisFn,
	getConsultationFn,
	getLiveConsultationFn,
	getSessionUserFn,
	listConsultationsFn,
	listPatientsFn,
	patientHistoryFn,
	recordConsentFn,
	saveConsultationFn,
	sessionFn,
} from "./fns.ts";

const section = (content: string): AnamnesisSection => ({
	content,
	confidence: "alta",
	evidence: ["frase"],
});

const makeAnamnesis = (chiefComplaint: string): Anamnesis => ({
	queixa_principal: section(chiefComplaint),
	hda: section("hda"),
	antecedentes: section("ant"),
	alergias: section("alg"),
	medicamentos_em_uso: section("med"),
	exame_fisico: section("exame"),
	hipoteses: section("hip"),
	conduta: section("cond"),
});

let cookie = "";

async function signIn(email: string) {
	await auth.api.signUpEmail({
		body: { email, password: "senha-forte-123", name: "Dra" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "senha-forte-123" }),
		}),
	);
	return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

describe("server fns", () => {
	beforeAll(async () => {
		cookie = await signIn("fns@x.com");
	});

	it("anonymous users get empty/null results", async () => {
		headers.current = new Headers();
		expect(await getSessionUserFn()).toBeNull();
		expect(await sessionFn()).toBeNull();
		expect(await listPatientsFn()).toEqual([]);
		expect(await listConsultationsFn()).toEqual([]);
		expect(await getConsultationFn({ data: 1 })).toBeNull();
		expect(await getLiveConsultationFn({ data: 1 })).toBeNull();
		expect(await patientHistoryFn({ data: { patientId: 1 } })).toBeNull();
		expect(
			await attachAnamnesisFn({
				data: { consultationId: 1, anamnesis: makeAnamnesis("x"), engine: "e" },
			}),
		).toEqual({ ok: false });
		expect(await recordConsentFn({ data: 1 })).toEqual({ ok: false });
		await expect(createPatientFn({ data: "X" })).rejects.toThrow("unauthenticated");
		await expect(
			saveConsultationFn({
				data: { transcript: "t", anamnesis: makeAnamnesis("q"), engine: "e" },
			}),
		).rejects.toThrow("unauthenticated");
		// LLM helpers are paid endpoints — anonymous calls must not proxy them.
		await expect(extractAnamnesisFn({ data: { transcript: "t" } })).rejects.toThrow(
			"unauthenticated",
		);
	});

	it("full patient + consultation lifecycle", async () => {
		headers.current = new Headers({ cookie });
		const patient = await createPatientFn({ data: "Maria Silva" });
		expect(patient!.id).toBeGreaterThan(0);
		expect((await listPatientsFn())[0]?.name).toBe("Maria Silva");

		const saved = await saveConsultationFn({
			data: {
				transcript: SAMPLE_TRANSCRIPT,
				anamnesis: makeAnamnesis("Dor de cabeça"),
				engine: "heuristic",
				patientId: patient!.id,
			},
		});
		expect(saved.id!).toBeGreaterThan(0);

		const list = await listConsultationsFn();
		expect(list).toHaveLength(1);
		expect(list[0]?.hasAnamnesis).toBe(true);
		expect(list[0]?.chiefComplaint).toBe("Dor de cabeça");
		expect(list[0]?.patientName).toBe("Maria Silva");

		const detail = await getConsultationFn({ data: saved.id! });
		expect(detail?.anamnesis?.queixa_principal.content).toBe("Dor de cabeça");
		expect(detail?.patientName).toBe("Maria Silva");

		expect(await getLiveConsultationFn({ data: saved.id! })).toMatchObject({
			transcript: SAMPLE_TRANSCRIPT,
		});
		expect(await getLiveConsultationFn({ data: 999 })).toBeNull();

		expect(await recordConsentFn({ data: saved.id! })).toEqual({ ok: true });
		expect(
			await attachAnamnesisFn({
				data: {
					consultationId: saved.id!,
					anamnesis: makeAnamnesis("Nova queixa"),
					engine: "openai",
				},
			}),
		).toEqual({ ok: true });

		const after = await getConsultationFn({ data: saved.id! });
		expect(after?.anamnesis?.queixa_principal.content).toBe("Nova queixa");
		expect(after?.engine).toBe("openai");
	});

	it("save without patientId and read null fields", async () => {
		headers.current = new Headers({ cookie });
		const saved = await saveConsultationFn({
			data: { transcript: "t2", anamnesis: makeAnamnesis("Q2"), engine: "heuristic" },
		});
		const detail = await getConsultationFn({ data: saved.id! });
		expect(detail?.anamnesis).not.toBeNull();
		expect(detail?.patientName).toBeNull();

		// bare consultation: null anamnesis parse branch
		const user = await getSessionUserFn();
		const { createConsultation } = await import("@ktb/consultations");
		const bare = await createConsultation(db, { userId: user!.id, source: "mic" });
		const bareDetail = await getConsultationFn({ data: bare });
		expect(bareDetail?.anamnesis).toBeNull();
	});

	it("attachAnamnesis with patientId set covers ?? left side", async () => {
		headers.current = new Headers({ cookie });
		const patient = await createPatientFn({ data: "João" });
		const saved = await saveConsultationFn({
			data: { transcript: "t3", anamnesis: makeAnamnesis("Q3"), engine: "e" },
		});
		await attachAnamnesisFn({
			data: {
				consultationId: saved.id!,
				anamnesis: makeAnamnesis("Q3b"),
				engine: "e2",
				patientId: patient!.id,
			},
		});
		const detail = await getConsultationFn({ data: saved.id! });
		expect(detail?.patientName).toBe("João");
	});

	it("listConsultations chiefComplaint null via ?? on missing queixa_principal", async () => {
		headers.current = new Headers({ cookie });
		const user = await getSessionUserFn();
		await db.insert(consultations).values({
			userId: user!.id,
			transcript: "t",
			anamnesis: "{}",
			engine: "e",
			createdAt: new Date(),
		});
		const list = await listConsultationsFn();
		expect(list.some((c) => c.chiefComplaint === null && c.hasAnamnesis)).toBe(true);
	});

	it("listConsultations tolerates invalid anamnesis JSON", async () => {
		headers.current = new Headers({ cookie });
		const user = await getSessionUserFn();
		await db.insert(consultations).values({
			userId: user!.id,
			transcript: "t",
			anamnesis: "{invalid",
			engine: "e",
			createdAt: new Date(),
		});
		const list = await listConsultationsFn();
		expect(list.some((c) => c.chiefComplaint === null && c.hasAnamnesis)).toBe(true);
	});

	it("extract fn returns a structured result", async () => {
		headers.current = new Headers({ cookie });
		const extracted = await extractAnamnesisFn({ data: { transcript: SAMPLE_TRANSCRIPT } });
		expect(extracted.anamnesis.queixa_principal.content).toBeTruthy();
		expect(extracted.engine).toBeTruthy();
		expect(extracted.anamnesis.historico).toBeUndefined();
	});

	it("patientHistoryFn summarizes prior consultations and feeds extraction", async () => {
		headers.current = new Headers({ cookie });
		const patient = await createPatientFn({ data: "Histórico" });
		await saveConsultationFn({
			data: {
				transcript: "t",
				anamnesis: makeAnamnesis("Primeira queixa"),
				engine: "heuristic",
				patientId: patient!.id,
			},
		});
		const second = await saveConsultationFn({
			data: {
				transcript: "t2",
				anamnesis: makeAnamnesis("Segunda queixa"),
				engine: "heuristic",
				patientId: patient!.id,
			},
		});
		// viewing the second consultation → history holds only the first
		const history = await patientHistoryFn({
			data: { patientId: patient!.id, excludeId: second.id! },
		});
		expect(history?.count).toBe(1);
		expect(history?.visits[0]?.chiefComplaint).toBe("Primeira queixa");
		// excluding nothing counts both consultations
		const all = await patientHistoryFn({ data: { patientId: patient!.id } });
		expect(all?.count).toBe(2);
		// unknown patient → null (not owned / not visible)
		expect(await patientHistoryFn({ data: { patientId: 99999 } })).toBeNull();

		// extraction with a linked patient injects the historico block
		const extracted = await extractAnamnesisFn({
			data: { transcript: SAMPLE_TRANSCRIPT, patientId: patient!.id },
		});
		expect(extracted.anamnesis.historico?.content).toContain("Consultas anteriores (2):");
		// patientId that resolves to no history → unchanged behavior
		const noHistory = await extractAnamnesisFn({
			data: { transcript: SAMPLE_TRANSCRIPT, patientId: 99999 },
		});
		expect(noHistory.anamnesis.historico).toBeUndefined();
	});

	it("services deny cross-user access via the bound principal", async () => {
		headers.current = new Headers({ cookie });
		const saved = await saveConsultationFn({
			data: { transcript: "t", anamnesis: makeAnamnesis("Q"), engine: "e" },
		});

		// Second user: lists are scoped empty; entity access is denied
		// (service fails Forbidden → handlers return the "not visible" shape).
		const cookie2 = await signIn("fns2@x.com");
		headers.current = new Headers({ cookie: cookie2 });
		expect(await listConsultationsFn()).toEqual([]);
		expect(await listPatientsFn()).toEqual([]);
		expect(await getConsultationFn({ data: saved.id! })).toBeNull();
		expect(await getLiveConsultationFn({ data: saved.id! })).toBeNull();
		expect(await recordConsentFn({ data: saved.id! })).toEqual({ ok: false });
		expect(
			await attachAnamnesisFn({
				data: { consultationId: saved.id!, anamnesis: makeAnamnesis("x"), engine: "e" },
			}),
		).toEqual({ ok: false });

		// Owner still reads fine afterwards.
		headers.current = new Headers({ cookie });
		expect(await getConsultationFn({ data: saved.id! })).not.toBeNull();
	});
});
