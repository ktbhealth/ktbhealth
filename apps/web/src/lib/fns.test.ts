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

import { env } from "cloudflare:workers";
import * as Effect from "effect/Effect";
import type { PanelPage } from "@ktb/kernel";
import { platformPages } from "./platform-pages.ts";
import { SAMPLE_TRANSCRIPT, type Anamnesis, type AnamnesisSection } from "@ktb/anamnesis";
import { auth, db } from "./platform.ts";
import { signUpDoctor } from "#/test/doctor.ts";
import { consultations } from "@ktb/db/schema";
import { eq } from "drizzle-orm";
import { audioBucketStore } from "#/test/cloudflare-workers.ts";
import {
	adminListAudioJobsFn,
	attachAnamnesisFn,
	countMyUnreadNotificationsFn,
	createPatientFn,
	deletePatientFn,
	emailEnabledFn,
	extractAnamnesisFn,
	getConsultationFn,
	getLiveConsultationFn,
	getPatientFn,
	getSessionUserFn,
	listConsultationsFn,
	listMyNotificationsFn,
	listPatientConsultationsFn,
	listPatientsFn,
	markAllMyNotificationsReadFn,
	markMyNotificationsReadFn,
	patientDeletionImpactFn,
	patientHistoryFn,
	platformAdminFn,
	platformPageDataFn,
	recordConsentFn,
	saveConsultationFn,
	sessionFn,
	updatePatientFn,
} from "./fns.ts";

/** Registers a patient through the server fn, failing the test on validation errors. */
async function newPatient(name: string, extra: Record<string, string> = {}) {
	const res = await createPatientFn({ data: { name, birthDate: "1984-03-05", ...extra } });
	if (!res.ok) throw new Error(`patient not created: ${JSON.stringify(res.errors)}`);
	return res.patient;
}

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
	await signUpDoctor({ email, password: "senha-forte-123", name: "Dra" });
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

	it("reports whether the deployment can send email", async () => {
		// Mirrors the bound Email driver: the test worker env decides.
		const { env } = await import("cloudflare:workers");
		const bound = env as { EMAIL_STUB?: unknown; EMAIL?: unknown; EMAIL_FROM?: unknown };
		expect(await emailEnabledFn()).toBe(
			Boolean(bound.EMAIL_STUB) || (Boolean(bound.EMAIL) && Boolean(bound.EMAIL_FROM)),
		);
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
		await expect(createPatientFn({ data: { name: "X", birthDate: "1984" } })).rejects.toThrow(
			"unauthenticated",
		);
		await expect(
			updatePatientFn({ data: { id: 1, name: "X", birthDate: "1984" } }),
		).rejects.toThrow("unauthenticated");
		expect(await getPatientFn({ data: 1 })).toBeNull();
		expect(await listPatientConsultationsFn({ data: 1 })).toEqual([]);
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
		const patient = await newPatient("Maria Silva");
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
		const patient = await newPatient("João");
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

	it("attachAnamnesis with patientId null clears the link (tri-state wire)", async () => {
		headers.current = new Headers({ cookie });
		const patient = await newPatient("Desvincular");
		const saved = await saveConsultationFn({
			data: { transcript: "t4", anamnesis: makeAnamnesis("Q4"), engine: "e" },
		});
		await attachAnamnesisFn({
			data: {
				consultationId: saved.id!,
				anamnesis: makeAnamnesis("Q4"),
				engine: "e",
				patientId: patient!.id,
			},
		});
		// An explicit null on the wire must reach the service as "clear",
		// not be dropped as "absent" by the normalizer.
		const res = await attachAnamnesisFn({
			data: {
				consultationId: saved.id!,
				anamnesis: makeAnamnesis("Q4b"),
				engine: "e",
				patientId: null,
			},
		});
		expect(res).toEqual({ ok: true });
		const detail = await getConsultationFn({ data: saved.id! });
		expect(detail?.patientName).toBeNull();
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
		const patient = await newPatient("Histórico");
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

	it("tolerates non-number patientId on the wire (undefined/null/string)", async () => {
		headers.current = new Headers({ cookie });
		const patient = await newPatient("Wire");
		// key present with undefined / null must not fail schema decode
		for (const patientId of [undefined, null, ""] as const) {
			const res = await extractAnamnesisFn({
				data: { transcript: SAMPLE_TRANSCRIPT, patientId: patientId as never },
			});
			expect(res.anamnesis).toBeTruthy();
		}
		// numeric string is coerced
		const res = await extractAnamnesisFn({
			data: { transcript: SAMPLE_TRANSCRIPT, patientId: String(patient!.id) as never },
		});
		expect(res.engine).toBeTruthy();
	});

	it("deletes a patient with their consultations and recordings", async () => {
		headers.current = new Headers({ cookie });
		const patient = await newPatient("Para Excluir");
		const { id: consultationId } = await saveConsultationFn({
			data: {
				transcript: "t",
				anamnesis: makeAnamnesis("Excluir"),
				engine: "e",
				patientId: patient.id,
			},
		});
		const audioKey = `audio/delete-${consultationId}.webm`;
		await env.AUDIO_BUCKET!.put(audioKey, new Uint8Array([1, 2, 3]));
		await db.update(consultations).set({ audioKey }).where(eq(consultations.id, consultationId));

		expect(await patientDeletionImpactFn({ data: patient.id })).toEqual({ consultations: 1 });
		expect(await patientDeletionImpactFn({ data: 999999 })).toBeNull();

		expect(await deletePatientFn({ data: patient.id })).toEqual({
			ok: true,
			consultations: 1,
			orphanedAudio: 0,
		});
		expect(await getPatientFn({ data: patient.id })).toBeNull();
		expect(await getConsultationFn({ data: consultationId })).toBeNull();
		expect(audioBucketStore.has(audioKey)).toBe(false);
		expect(await deletePatientFn({ data: patient.id })).toEqual({ ok: false });

		headers.current = new Headers();
		expect(await patientDeletionImpactFn({ data: patient.id })).toBeNull();
	});

	it("never previews or deletes someone else's patient", async () => {
		headers.current = new Headers({ cookie });
		const patient = await newPatient("Alheio");
		headers.current = new Headers({ cookie: await signIn("fns-intruder@x.com") });
		expect(await patientDeletionImpactFn({ data: patient.id })).toBeNull();
		expect(await deletePatientFn({ data: patient.id })).toEqual({ ok: false });
		headers.current = new Headers({ cookie });
		expect((await getPatientFn({ data: patient.id }))?.name).toBe("Alheio");
	});

	it("createPatientFn returns field errors instead of saving", async () => {
		headers.current = new Headers({ cookie });
		const before = (await listPatientsFn()).length;
		const res = await createPatientFn({
			data: { name: " ", birthDate: "2999-01-01", cpf: "111.111.111-11", phone: null },
		});
		expect(res).toEqual({
			ok: false,
			errors: {
				name: "name_required",
				birthDate: "future_date",
				cpf: "invalid_cpf",
			},
		});
		expect((await listPatientsFn()).length).toBe(before);
	});

	it("gets, updates and lists consultations for a full FHIR record", async () => {
		headers.current = new Headers({ cookie });
		const patient = await newPatient("Registro Completo", {
			gender: "female",
			cpf: "529.982.247-25",
			country: "BR",
			state: "pe",
			postalCode: "50050-000",
		});
		expect(patient).toMatchObject({ cpf: "52998224725", state: "PE", postalCode: "50050000" });
		expect((await getPatientFn({ data: patient.id }))?.name).toBe("Registro Completo");
		expect(await getPatientFn({ data: 999999 })).toBeNull();

		// wire tolerance: numeric-string id, nullable fields
		const updated = await updatePatientFn({
			data: {
				id: String(patient.id) as never,
				name: "Registro Editado",
				birthDate: "1984",
				city: null,
				active: false,
			},
		});
		expect(updated).toMatchObject({
			ok: true,
			patient: { name: "Registro Editado", active: false },
		});
		expect(
			await updatePatientFn({ data: { id: patient.id, name: "", birthDate: "1984" } }),
		).toEqual({ ok: false, errors: { name: "name_required" } });
		expect(
			await updatePatientFn({ data: { id: 999999, name: "Ghost", birthDate: "1984" } }),
		).toEqual({ ok: false, errors: {} });

		await saveConsultationFn({
			data: {
				transcript: "t",
				anamnesis: makeAnamnesis("Do paciente"),
				engine: "e",
				patientId: patient.id,
			},
		});
		await saveConsultationFn({
			data: { transcript: "t", anamnesis: makeAnamnesis("Sem paciente"), engine: "e" },
		});
		const own = await listPatientConsultationsFn({ data: patient.id });
		expect(own.map((c) => c.chiefComplaint)).toEqual(["Do paciente"]);
		expect(own[0]?.patientId).toBe(patient.id);
	});

	it("extraction receives the record's sex and age as context", async () => {
		headers.current = new Headers({ cookie });
		const patient = await newPatient("Contexto", { gender: "male" });
		const run = vi.spyOn(env.AI, "run");
		try {
			await extractAnamnesisFn({ data: { transcript: SAMPLE_TRANSCRIPT, patientId: patient.id } });
			const input = run.mock.calls.at(-1)?.[1] as { messages: Array<{ content: string }> };
			expect(input.messages[0]!.content).toMatch(
				/PATIENT — from the patient record \(context only, NOT evidence\): male, \d+ years old\./,
			);
		} finally {
			run.mockRestore();
		}
	});

	it("services deny cross-user access via the bound principal", async () => {
		headers.current = new Headers({ cookie });
		const saved = await saveConsultationFn({
			data: { transcript: "t", anamnesis: makeAnamnesis("Q"), engine: "e" },
		});
		const foreignPatient = await newPatient("Alheio");

		// Second user: lists are scoped empty; entity access is denied
		// (service fails Forbidden → handlers return the "not visible" shape).
		const cookie2 = await signIn("fns2@x.com");
		headers.current = new Headers({ cookie: cookie2 });
		expect(await listConsultationsFn()).toEqual([]);
		expect(await listPatientsFn()).toEqual([]);
		expect(await getPatientFn({ data: foreignPatient.id })).toBeNull();
		expect(
			await updatePatientFn({ data: { id: foreignPatient.id, name: "Hijack", birthDate: "1984" } }),
		).toEqual({ ok: false, errors: {} });
		// someone else's patient is not used as extraction context
		const extracted = await extractAnamnesisFn({
			data: { transcript: SAMPLE_TRANSCRIPT, patientId: foreignPatient.id },
		});
		expect(extracted.anamnesis).toBeTruthy();
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

	it("platform admin gate: allowlist decides /platform access", async () => {
		// Anonymous → not admin, no loader data (the layout guard
		// redirects/404s before any page loader runs).
		headers.current = new Headers();
		expect(await platformAdminFn()).toBe(false);
		expect(await platformPageDataFn({ data: "/platform/patients" })).toEqual({
			status: "notfound",
		});
		expect(await platformPageDataFn({ data: "/platform/consultations" })).toEqual({
			status: "notfound",
		});
		expect(await adminListAudioJobsFn()).toEqual([]);
		expect(await platformPageDataFn({ data: "/platform/users" })).toEqual({ status: "notfound" });
		expect(await platformPageDataFn({ data: "/platform/groups" })).toEqual({ status: "notfound" });
		// Unknown console paths have no descriptor → notfound.
		expect(await platformPageDataFn({ data: "/platform/nope" })).toEqual({ status: "notfound" });

		// Signed-in non-admin → still not admin; page loaders collapse
		// Forbidden to the same empty tables the old fns returned.
		headers.current = new Headers({ cookie });
		expect(await platformAdminFn()).toBe(false);
		expect(await platformPageDataFn({ data: "/platform/patients" })).toEqual({
			status: "ok",
			data: [],
		});
		expect(await platformPageDataFn({ data: "/platform/consultations" })).toEqual({
			status: "ok",
			data: [],
		});
		expect(await adminListAudioJobsFn()).toEqual([]);
		expect(await platformPageDataFn({ data: "/platform/users" })).toEqual({
			status: "ok",
			data: [],
		});
		expect(await platformPageDataFn({ data: "/platform/groups" })).toEqual({
			status: "ok",
			data: [],
		});

		// Allowlisted admin (PLATFORM_ADMIN_EMAILS test double) → full
		// cross-owner listing.
		const adminCookie = await signIn("platform-admin@ktb.test");
		headers.current = new Headers({ cookie: adminCookie });
		expect(await platformAdminFn()).toBe(true);
		const pageData = async (path: string) => {
			const res = await platformPageDataFn({ data: path });
			if (res.status !== "ok") throw new Error(`expected ok, got ${res.status}`);
			return res.data;
		};
		const rows = (await pageData("/platform/patients")) as {
			ownerEmail: string | null;
		}[];
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.some((r) => r.ownerEmail === "fns@x.com")).toBe(true);

		// Same gate covers the consultations and users console listings.
		const consultRows = (await pageData("/platform/consultations")) as {
			ownerEmail?: string;
		}[];
		expect(Array.isArray(consultRows)).toBe(true);
		expect(consultRows.every((r) => r.ownerEmail !== undefined)).toBe(true);
		const userRows = (await pageData("/platform/users")) as {
			isAdmin: boolean;
		}[];
		expect(Array.isArray(userRows)).toBe(true);
		expect(userRows.every((r) => typeof r.isAdmin === "boolean")).toBe(true);
		const groupRows = (await pageData("/platform/groups")) as {
			memberCount: number;
		}[];
		expect(Array.isArray(groupRows)).toBe(true);
		expect(groupRows.every((r) => typeof r.memberCount === "number")).toBe(true);
		// The audioJobs CQRS query answers the same admin gate.
		const audioJobs = await adminListAudioJobsFn();
		expect(Array.isArray(audioJobs)).toBe(true);
		// The dashboard index aggregates listings + notification activity.
		const dashboard = (await pageData("/platform")) as {
			patients: unknown[];
			consultations: unknown[];
			notifications?: unknown[];
			unreadCount?: number;
		};
		expect(dashboard.patients.length).toBeGreaterThan(0);
		expect(Array.isArray(dashboard.consultations)).toBe(true);
		expect(Array.isArray(dashboard.notifications)).toBe(true);
		expect(typeof dashboard.unreadCount).toBe("number");
	});

	it("platform page guard: false reports notfound and skips the loader", async () => {
		headers.current = new Headers({ cookie });
		let loaderRan = false;
		const base = {
			component: () => null,
			loader: () =>
				Effect.sync(() => {
					loaderRan = true;
					return "loaded";
				}),
		};
		const denied: PanelPage = {
			...base,
			id: "test.denied",
			path: "/platform/test-denied",
			guard: () => Effect.succeed(false),
		};
		const allowed: PanelPage = {
			...base,
			id: "test.allowed",
			path: "/platform/test-allowed",
			guard: () => Effect.succeed(true),
		};
		// No shipped plugin uses `guard` yet — register throwaway
		// descriptors directly on the (mutable) registry map.
		const pages = platformPages as unknown as Map<string, PanelPage>;
		pages.set(denied.path, denied);
		pages.set(allowed.path, allowed);
		try {
			expect(await platformPageDataFn({ data: denied.path })).toEqual({ status: "notfound" });
			expect(loaderRan).toBe(false);
			expect(await platformPageDataFn({ data: allowed.path })).toEqual({
				status: "ok",
				data: "loaded",
			});
			expect(loaderRan).toBe(true);
		} finally {
			pages.delete(denied.path);
			pages.delete(allowed.path);
		}
	});

	it("notifications fns list, count and mark read for the session user", async () => {
		headers.current = new Headers();
		expect(await listMyNotificationsFn()).toEqual([]);
		expect(await countMyUnreadNotificationsFn()).toBe(0);

		headers.current = new Headers({ cookie });
		// PatientCreated → a persisted notification via the event bus.
		await newPatient("Notificada");
		const list = await listMyNotificationsFn();
		expect(list.some((n) => n.title === "Patient created")).toBe(true);
		const unread = await countMyUnreadNotificationsFn();
		expect(unread).toBeGreaterThan(0);

		const target = list.find((n) => n.title === "Patient created")!;
		expect(await markMyNotificationsReadFn({ data: [Number(target.id)] })).toBe(true);
		expect(await countMyUnreadNotificationsFn()).toBe(unread - 1);

		expect(await markAllMyNotificationsReadFn()).toBe(true);
		expect(await countMyUnreadNotificationsFn()).toBe(0);
		// Ids that aren't yours are ignored, not errors.
		expect(await markMyNotificationsReadFn({ data: [999999] })).toBe(true);
	});
});
