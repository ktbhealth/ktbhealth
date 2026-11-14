import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { Anamnesis, AnamnesisSection } from "@ktb/anamnesis/types";
import { Principal } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";

import {
	countAwaitingInvites,
	getPortalConsultation,
	getPortalProfile,
	listPortalConsultations,
	PatientPortal,
	PatientPortalLive,
	patientPortalRoutesPlugin,
	patientPortalServicesPlugin,
	plugins,
	portalSections,
} from "./index.ts";

const section = (content: string): AnamnesisSection => ({
	content,
	confidence: "alta",
	// Transcript sentences — must never reach the portal.
	evidence: ["o paciente disse isso"],
});

const anamnesis = (overrides: Partial<Anamnesis> = {}): Anamnesis => ({
	queixa_principal: section("Dor de cabeça há três dias"),
	hda: section("Início súbito, piora à noite"),
	antecedentes: section(""),
	alergias: section("  "),
	medicamentos_em_uso: section("Losartana 50 mg"),
	exame_fisico: section("A preencher pelo médico: exame físico."),
	hipoteses: section("Cefaleia tensional"),
	conduta: section("Retorno em 15 dias"),
	historico: section("2 consultas anteriores"),
	...overrides,
});

const json = (a: Anamnesis) => JSON.stringify(a).replaceAll("'", "''");

// "ana" is the patient Ana (record 1, kept by Dra. Bia) and guardian of
// Leo (record 2, kept by a doctor with no profile row). Her link to Rui
// (record 3) is still pending and the one to Ivo (record 4) revoked. Her
// email is unverified, so the invite for record 5 addressed to it sits
// "invited" — eva's verified address sees no such wait.
// Consultations: 10 and 11 are Ana's saved records, 12 is still being
// transcribed (no anamnesis), 13 holds JSON that no longer decodes, 15
// is not JSON at all, 14 was saved with no chief complaint, 20 is
// Leo's, 30 Rui's and 40 Ivo's.
const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL DEFAULT 0, updated_at INTEGER);
INSERT INTO user (id, name, email, email_verified) VALUES
  ('ana', 'Ana', 'ana@ktb.test', 0),
  ('eva', 'Eva', 'eva@ktb.test', 1);
CREATE TABLE doctors (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, display_name TEXT NOT NULL);
INSERT INTO doctors (user_id, display_name) VALUES ('doc', 'Dra. Bia');
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL);
INSERT INTO patients (id, owner_id, name) VALUES
  (1, 'doc', 'Ana'), (2, 'other', 'Leo'), (3, 'doc', 'Rui'), (4, 'doc', 'Ivo'), (5, 'doc', 'Sia');
CREATE TABLE patient_access (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER NOT NULL, user_id TEXT, email TEXT, relation TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, granted_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO patient_access (patient_id, user_id, relation, status, source, created_at, updated_at) VALUES
  (1, 'ana', 'self', 'active', 'invite', 0, 0),
  (2, 'ana', 'guardian', 'active', 'invite', 0, 0),
  (3, 'ana', 'self', 'pending', 'cpf', 0, 0),
  (4, 'ana', 'guardian', 'revoked', 'invite', 0, 0);
INSERT INTO patient_access (patient_id, user_id, email, relation, status, source, created_at, updated_at) VALUES
  (5, NULL, 'ana@ktb.test', 'self', 'invited', 'invite', 0, 0),
  (5, NULL, 'nobody@ktb.test', 'self', 'invited', 'invite', 0, 0);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, patient_id INTEGER, transcript TEXT NOT NULL, anamnesis TEXT, created_at INTEGER NOT NULL);
INSERT INTO consultations (id, user_id, patient_id, transcript, anamnesis, created_at) VALUES
  (10, 'doc', 1, 'fala da consulta', '${json(anamnesis())}', 1000),
  (11, 'doc', 1, 'fala da consulta', '${json(anamnesis({ queixa_principal: section("Retorno") }))}', 2000),
  (12, 'doc', 1, 'ainda transcrevendo', NULL, 3000),
  (13, 'doc', 1, 'fala da consulta', '{"queixa_principal":1}', 4000),
  (14, 'doc', 1, 'fala da consulta', '${json(anamnesis({ queixa_principal: section("") }))}', 500),
  (15, 'doc', 1, 'fala da consulta', 'not json', 4500),
  (20, 'other', 2, 'fala da consulta', '${json(anamnesis())}', 1000),
  (30, 'doc', 3, 'fala da consulta', '${json(anamnesis())}', 1000),
  (40, 'doc', 4, 'fala da consulta', '${json(anamnesis())}', 1000);
`;

describe("portalSections", () => {
	it("keeps what the doctor wrote, in document order, without drafting metadata", () => {
		expect(portalSections(anamnesis())).toEqual([
			{ key: "queixa_principal", content: "Dor de cabeça há três dias" },
			{ key: "hda", content: "Início súbito, piora à noite" },
			{ key: "medicamentos_em_uso", content: "Losartana 50 mg" },
			{ key: "hipoteses", content: "Cefaleia tensional" },
			{ key: "conduta", content: "Retorno em 15 dias" },
		]);
	});

	it("drops blank sections and the drafter's placeholder", () => {
		const keys = portalSections(anamnesis()).map((s) => s.key);
		expect(keys).not.toContain("antecedentes");
		expect(keys).not.toContain("alergias");
		expect(keys).not.toContain("exame_fisico");
	});
});

describe("getPortalProfile", () => {
	const db = makeDb(makeD1(DDL));

	it("names the record and the doctor who keeps it", async () => {
		expect(await getPortalProfile(db, "ana", 1)).toEqual({
			patientId: 1,
			relation: "self",
			name: "Ana",
			doctorName: "Dra. Bia",
		});
	});

	it("has no doctor name when the owner has no doctor profile", async () => {
		expect(await getPortalProfile(db, "ana", 2)).toMatchObject({ name: "Leo", doctorName: null });
	});

	it("is null without an active link", async () => {
		expect(await getPortalProfile(db, "ana", 3)).toBeNull();
		expect(await getPortalProfile(db, "ana", 4)).toBeNull();
		expect(await getPortalProfile(db, "eva", 1)).toBeNull();
	});
});

describe("listPortalConsultations", () => {
	const db = makeDb(makeD1(DDL));

	it("lists the saved records of a linked patient, newest first", async () => {
		expect(await listPortalConsultations(db, "ana", 1)).toEqual([
			{ id: 11, createdAt: new Date(2_000_000), chiefComplaint: "Retorno" },
			{ id: 10, createdAt: new Date(1_000_000), chiefComplaint: "Dor de cabeça há três dias" },
			{ id: 14, createdAt: new Date(500_000), chiefComplaint: null },
		]);
	});

	it("leaves out consultations without a saved, readable record", async () => {
		const ids = (await listPortalConsultations(db, "ana", 1)).map((c) => c.id);
		expect(ids).not.toContain(12);
		expect(ids).not.toContain(13);
		expect(ids).not.toContain(15);
	});

	it("is scoped to the record asked for", async () => {
		expect((await listPortalConsultations(db, "ana", 2)).map((c) => c.id)).toEqual([20]);
	});

	it("shows nothing through a pending or revoked link, or to a stranger", async () => {
		expect(await listPortalConsultations(db, "ana", 3)).toEqual([]);
		expect(await listPortalConsultations(db, "ana", 4)).toEqual([]);
		expect(await listPortalConsultations(db, "eva", 1)).toEqual([]);
	});
});

describe("getPortalConsultation", () => {
	const db = makeDb(makeD1(DDL));

	it("returns the saved record with who it is about and who recorded it", async () => {
		const consultation = await getPortalConsultation(db, "ana", 10);
		expect(consultation).toMatchObject({
			id: 10,
			createdAt: new Date(1_000_000),
			patientId: 1,
			patientName: "Ana",
			doctorName: "Dra. Bia",
		});
		expect(consultation!.sections.map((s) => s.key)).toEqual([
			"queixa_principal",
			"hda",
			"medicamentos_em_uso",
			"hipoteses",
			"conduta",
		]);
	});

	it("never carries the transcript, its evidence or the raw document", async () => {
		const wire = JSON.stringify(await getPortalConsultation(db, "ana", 10));
		expect(wire).not.toContain("fala da consulta");
		expect(wire).not.toContain("o paciente disse isso");
		expect(wire).not.toContain("confidence");
		expect(wire).not.toContain("2 consultas anteriores");
	});

	it("has no doctor name when the recording doctor has no profile", async () => {
		expect(await getPortalConsultation(db, "ana", 20)).toMatchObject({ doctorName: null });
	});

	it("is null for a consultation with no saved, readable record", async () => {
		expect(await getPortalConsultation(db, "ana", 12)).toBeNull();
		expect(await getPortalConsultation(db, "ana", 13)).toBeNull();
		expect(await getPortalConsultation(db, "ana", 15)).toBeNull();
	});

	it("is null without an active link, and for a missing consultation", async () => {
		expect(await getPortalConsultation(db, "ana", 30)).toBeNull();
		expect(await getPortalConsultation(db, "ana", 40)).toBeNull();
		expect(await getPortalConsultation(db, "eva", 10)).toBeNull();
		expect(await getPortalConsultation(db, "ana", 999)).toBeNull();
	});
});

describe("countAwaitingInvites", () => {
	const db = makeDb(makeD1(DDL));

	it("counts the invites an unverified address cannot claim yet", async () => {
		expect(await countAwaitingInvites(db, "ana")).toBe(1);
	});

	it("is zero for a verified address and for a stranger or unknown account", async () => {
		expect(await countAwaitingInvites(db, "eva")).toBe(0);
		expect(await countAwaitingInvites(db, "ghost")).toBe(0);
	});
});

describe("PatientPortalLive", () => {
	let runtime: ManagedRuntime.ManagedRuntime<PatientPortal, never>;
	const d1 = makeD1(DDL);

	beforeAll(() => {
		runtime = ManagedRuntime.make(
			PatientPortalLive.pipe(Layer.provide(Layer.succeed(Db, makeDb(d1)))),
		);
	});

	afterAll(() => runtime.dispose());

	type Who = { userId: string; actorId?: string } | null;
	const as = <A, E>(who: Who, use: (portal: PatientPortal["Service"]) => Effect.Effect<A, E>) =>
		runtime.runPromise(
			Effect.flatMap(PatientPortal, use).pipe(Effect.provideService(Principal, who), Effect.result),
		);
	const ana: Who = { userId: "ana" };

	it("opens a linked record and lists its consultations", async () => {
		expect(await as(ana, (p) => p.profile(1))).toMatchObject({
			_tag: "Success",
			success: { name: "Ana", doctorName: "Dra. Bia" },
		});
		const listed = await as(ana, (p) => p.consultations(1));
		expect(listed._tag === "Success" && listed.success.map((c) => c.id)).toEqual([11, 10, 14]);
	});

	it("opens one consultation of a linked record", async () => {
		expect(await as(ana, (p) => p.consultation(10))).toMatchObject({
			_tag: "Success",
			success: { id: 10, patientName: "Ana" },
		});
	});

	it("refuses records and consultations the caller holds no active link to", async () => {
		for (const result of [
			await as(ana, (p) => p.profile(3)),
			await as(ana, (p) => p.consultation(30)),
			await as(ana, (p) => p.consultation(12)),
			await as({ userId: "eva" }, (p) => p.consultation(10)),
		]) {
			expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "Forbidden" } });
		}
		expect(await as({ userId: "eva" }, (p) => p.consultations(1))).toMatchObject({
			_tag: "Success",
			success: [],
		});
	});

	it("reports invites waiting on email verification", async () => {
		expect(await as(ana, (p) => p.awaitingInvites())).toMatchObject({
			_tag: "Success",
			success: 1,
		});
		expect(await as({ userId: "eva" }, (p) => p.awaitingInvites())).toMatchObject({
			_tag: "Success",
			success: 0,
		});
	});

	it("refuses anonymous callers and anyone acting for a doctor", async () => {
		for (const who of [null, { userId: "ana", actorId: "sec" }]) {
			for (const result of [
				await as(who, (p) => p.profile(1)),
				await as(who, (p) => p.consultations(1)),
				await as(who, (p) => p.consultation(10)),
				await as(who, (p) => p.awaitingInvites()),
			]) {
				expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "Forbidden" } });
			}
		}
	});
});

describe("patient-portal plugins", () => {
	it("contributes the portal service and its route subtree", () => {
		expect(plugins).toEqual([patientPortalServicesPlugin, patientPortalRoutesPlugin]);
		expect(patientPortalServicesPlugin.id).toBe("patient-portal.services");
		expect(patientPortalServicesPlugin.services).toBe(PatientPortalLive);
		expect(patientPortalRoutesPlugin.id).toBe("patient-portal.routes");
		expect(patientPortalRoutesPlugin.routes).toHaveLength(1);
	});
});
