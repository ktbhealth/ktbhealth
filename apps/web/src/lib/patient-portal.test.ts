import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
	getRequestUrl: () => new URL("http://localhost:3000/consultations/new"),
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

import type { Anamnesis, AnamnesisSection } from "@ktb/anamnesis";
import { newConsultationApi } from "@ktb/consultations/apis";
import { patientAccess, user } from "@ktb/db/schema";
import { doctorContextFn } from "@ktb/doctors/fns";
import { approvePatientLinkFn, patientLinksFn, revokePatientLinkFn } from "@ktb/patient-access/fns";
import { portalConsultationFn, portalFn, setCpfFn } from "@ktb/patient-portal/fns";
import { eq } from "drizzle-orm";

import { signUpDoctor } from "#/test/doctor.ts";
import { auth, db } from "./platform.ts";
import {
	createPatientFn,
	emailEnabledFn,
	getConsultationFn,
	listConsultationsFn,
	listPatientsFn,
	saveConsultationFn,
	sessionFn,
} from "./fns.ts";

// End to end: the doctor saves a consultation and sends the patient the
// access email; the patient's account then sees that consultation —
// read-only, and nothing of the doctor side.

const PASSWORD = "senha-forte-123";

async function signIn(email: string) {
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: PASSWORD }),
		}),
	);
	return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

/** A patient account: signed up, never given a doctor profile. */
async function signUpPatient(email: string, name: string, verified: boolean) {
	await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
	if (verified) await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
	return signIn(email);
}

const as = (cookie: string) => {
	headers.current = new Headers({ cookie });
};

const section = (content: string): AnamnesisSection => ({
	content,
	confidence: "alta",
	evidence: ["trecho da transcrição"],
});
const anamnesis: Anamnesis = {
	queixa_principal: section("Dor de cabeça há três dias"),
	hda: section("Início súbito"),
	antecedentes: section(""),
	alergias: section("Nega alergias"),
	medicamentos_em_uso: section("Losartana 50 mg"),
	exame_fisico: section("A preencher pelo médico: exame físico."),
	hipoteses: section("Cefaleia tensional"),
	conduta: section("Retorno em 15 dias"),
};

describe("patient portal, end to end", () => {
	let doctor = "";
	let patient = "";
	let stranger = "";
	let patientId = 0;
	let consultationId = 0;

	beforeAll(async () => {
		await signUpDoctor({ email: "portal-doctor@x.com", password: PASSWORD, name: "Dra. Portal" });
		doctor = await signIn("portal-doctor@x.com");
		as(doctor);
		const created = await createPatientFn({
			data: { name: "Paciente Portal", birthDate: "1984-03-05", email: "portal-patient@x.com" },
		});
		if (!created.ok) throw new Error(`patient not created: ${JSON.stringify(created.errors)}`);
		patientId = created.patient.id;
		const saved = await saveConsultationFn({
			data: { transcript: "fala gravada na consulta", anamnesis, engine: "heuristic", patientId },
		});
		consultationId = saved.id;
	});

	it("after saving, the doctor is told the patient has no portal access yet", async () => {
		as(doctor);
		expect(await newConsultationApi.patientAccess!({ data: patientId })).toEqual({
			email: "portal-patient@x.com",
			hasAccess: false,
		});
	});

	it("sending the access email invites the patient's address", async () => {
		as(doctor);
		expect(
			await newConsultationApi.invitePatient!({
				data: { patientId, email: "portal-patient@x.com" },
			}),
		).toEqual({ ok: true, emailed: await emailEnabledFn() });
		// Asked again on a later save, the question is no longer needed.
		expect(await newConsultationApi.patientAccess!({ data: patientId })).toMatchObject({
			hasAccess: true,
		});
		const [link] = await db
			.select()
			.from(patientAccess)
			.where(eq(patientAccess.patientId, patientId));
		expect(link).toMatchObject({ email: "portal-patient@x.com", status: "invited", userId: null });
	});

	it("an unverified account with the invited address sees nothing", async () => {
		patient = await signUpPatient("portal-patient@x.com", "Paciente Portal", false);
		as(patient);
		expect(await portalFn()).toMatchObject({ profiles: [], profile: null, consultations: [] });
		expect(await portalConsultationFn({ data: consultationId })).toEqual({ status: "missing" });
	});

	it("once the address is verified, the patient sees the consultation", async () => {
		await db
			.update(user)
			.set({ emailVerified: true })
			.where(eq(user.email, "portal-patient@x.com"));
		as(patient);
		const portal = await portalFn();
		expect(portal).toMatchObject({
			profiles: [{ patientId, name: "Paciente Portal", relation: "self" }],
			profile: { patientId, name: "Paciente Portal", doctorName: "Dra. Portal" },
		});
		expect(portal!.consultations).toEqual([
			{
				id: consultationId,
				createdAt: expect.any(Date),
				chiefComplaint: "Dor de cabeça há três dias",
			},
		]);
	});

	it("the consultation opens read-only: the doctor's record, no transcript", async () => {
		as(patient);
		const result = await portalConsultationFn({ data: consultationId });
		expect(result).toMatchObject({
			status: "ok",
			consultation: {
				id: consultationId,
				patientName: "Paciente Portal",
				doctorName: "Dra. Portal",
				sections: [
					{ key: "queixa_principal", content: "Dor de cabeça há três dias" },
					{ key: "hda", content: "Início súbito" },
					{ key: "alergias", content: "Nega alergias" },
					{ key: "medicamentos_em_uso", content: "Losartana 50 mg" },
					{ key: "hipoteses", content: "Cefaleia tensional" },
					{ key: "conduta", content: "Retorno em 15 dias" },
				],
			},
		});
		const wire = JSON.stringify(result);
		expect(wire).not.toContain("fala gravada na consulta");
		expect(wire).not.toContain("trecho da transcrição");
	});

	it("a patient account is patient-only: no doctor profile, no doctor data, no writes", async () => {
		as(patient);
		expect(await sessionFn()).toMatchObject({ email: "portal-patient@x.com", patientOnly: true });
		expect(await doctorContextFn()).toEqual({ profiles: [], activeDoctorId: null });
		expect(await listConsultationsFn()).toEqual([]);
		expect(await listPatientsFn()).toEqual([]);
		expect(await getConsultationFn({ data: consultationId })).toBeNull();
		await expect(
			saveConsultationFn({ data: { transcript: "x", anamnesis, engine: "heuristic" } }),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			createPatientFn({ data: { name: "Outro", birthDate: "1984-03-05" } }),
		).rejects.toMatchObject({ status: 403 });
	});

	it("the doctor keeps the doctor side", async () => {
		as(doctor);
		expect(await sessionFn()).toMatchObject({ email: "portal-doctor@x.com", patientOnly: false });
	});

	it("another patient account cannot open it", async () => {
		stranger = await signUpPatient("portal-stranger@x.com", "Estranho", true);
		as(stranger);
		expect(await portalFn()).toMatchObject({ profiles: [], consultations: [] });
		expect(await portalConsultationFn({ data: consultationId })).toEqual({ status: "missing" });
	});

	it("anonymous visitors get nothing", async () => {
		headers.current = new Headers();
		expect(await sessionFn()).toBeNull();
		expect(await portalFn()).toBeNull();
		expect(await portalConsultationFn({ data: consultationId })).toEqual({ status: "anonymous" });
	});

	it("the doctor removing the access closes the portal again", async () => {
		as(doctor);
		const record = await patientLinksFn({ data: patientId });
		expect(record!.links).toMatchObject([{ email: "portal-patient@x.com", status: "active" }]);
		expect(await revokePatientLinkFn({ data: record!.links[0]!.id })).toEqual({ ok: true });
		as(patient);
		expect(await portalFn()).toMatchObject({ profiles: [], consultations: [] });
		expect(await portalConsultationFn({ data: consultationId })).toEqual({ status: "missing" });
	});
});

describe("patient portal, CPF match awaiting approval", () => {
	const CPF = "529.982.247-25";
	let doctor = "";
	let patient = "";
	let patientId = 0;
	let consultationId = 0;

	beforeAll(async () => {
		await signUpDoctor({ email: "cpf-doctor@x.com", password: PASSWORD, name: "Dr. Cpf" });
		doctor = await signIn("cpf-doctor@x.com");
		as(doctor);
		// The record carries the patient's CPF but another email address.
		const created = await createPatientFn({
			data: { name: "Paciente Cpf", birthDate: "1990-01-01", cpf: CPF, email: "antigo@x.com" },
		});
		if (!created.ok) throw new Error(`patient not created: ${JSON.stringify(created.errors)}`);
		patientId = created.patient.id;
		const saved = await saveConsultationFn({
			data: { transcript: "fala", anamnesis, engine: "heuristic", patientId },
		});
		consultationId = saved.id;
		patient = await signUpPatient("cpf-patient@x.com", "Paciente Cpf", true);
	});

	const linkOf = async () => {
		as(doctor);
		return (await patientLinksFn({ data: patientId }))!.links[0];
	};

	it("a CPF match alone opens nothing: the link waits for the doctor", async () => {
		as(patient);
		expect(await setCpfFn({ data: CPF })).toEqual({ ok: true });
		expect(await portalFn()).toMatchObject({ profiles: [], consultations: [] });
		expect(await portalConsultationFn({ data: consultationId })).toEqual({ status: "missing" });
		expect(await linkOf()).toMatchObject({
			email: "cpf-patient@x.com",
			status: "pending",
			source: "cpf",
		});
	});

	it("a patient account cannot approve its own link", async () => {
		const link = await linkOf();
		as(patient);
		expect(await approvePatientLinkFn({ data: link!.id })).toEqual({ ok: false });
		expect(await linkOf()).toMatchObject({ status: "pending" });
	});

	it("another doctor cannot approve it either", async () => {
		const link = await linkOf();
		await signUpDoctor({ email: "cpf-other@x.com", password: PASSWORD, name: "Dra. Outra" });
		as(await signIn("cpf-other@x.com"));
		expect(await approvePatientLinkFn({ data: link!.id })).toEqual({ ok: false });
		expect(await linkOf()).toMatchObject({ status: "pending" });
	});

	it("once the doctor approves, the patient sees the consultation", async () => {
		const link = await linkOf();
		as(doctor);
		expect(await approvePatientLinkFn({ data: link!.id })).toEqual({ ok: true });
		// Approving twice is refused: there is nothing pending any more.
		expect(await approvePatientLinkFn({ data: link!.id })).toEqual({ ok: false });
		expect(await linkOf()).toMatchObject({ status: "active" });
		as(patient);
		const portal = await portalFn();
		expect(portal).toMatchObject({ profile: { patientId, name: "Paciente Cpf" } });
		expect(portal!.consultations.map((c) => c.id)).toEqual([consultationId]);
		expect(await portalConsultationFn({ data: consultationId })).toMatchObject({ status: "ok" });
	});
});
