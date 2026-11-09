/** Test fixtures shared by the interop adapters. */
import type { Anamnesis, AnamnesisSection } from "@ktb/anamnesis";

import type { ClinicalRecordExport, ConsultationRecord, PatientRecord } from "./index.ts";

const section = (content: string): AnamnesisSection => ({
	content,
	confidence: "alta",
	evidence: ["Paciente relata dor de cabeça há três dias."],
});

/** A name-only record — the minimum the registry accepts. */
export const makePatientRecord = (over: Partial<PatientRecord> = {}): PatientRecord => ({
	id: 1,
	active: true,
	name: "Maria Silva",
	socialName: null,
	gender: null,
	birthDate: null,
	cpf: null,
	cns: null,
	passport: null,
	phone: null,
	email: null,
	preferredLanguage: null,
	addressLine: null,
	addressNumber: null,
	addressComplement: null,
	district: null,
	city: null,
	state: null,
	postalCode: null,
	country: null,
	motherName: null,
	maritalStatus: null,
	raceColor: null,
	nationality: null,
	emergencyContactName: null,
	emergencyContactRelationship: null,
	emergencyContactPhone: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	updatedAt: null,
	...over,
});

/** Every field filled, BR Core-complete. */
export const FULL_PATIENT = makePatientRecord({
	id: 7,
	name: "Maria Aparecida Silva",
	socialName: "Cida",
	gender: "female",
	birthDate: "1984-03-05",
	cpf: "52998224725",
	cns: "100000000000007",
	passport: "FX123456",
	phone: "+55 81 98765-4321",
	email: "cida@example.com",
	preferredLanguage: "pt-BR",
	addressLine: "Rua da Aurora",
	addressNumber: "100",
	addressComplement: "apto 12",
	district: "Boa Vista",
	city: "Recife",
	state: "PE",
	postalCode: "50050000",
	country: "BR",
	motherName: "Josefa Silva",
	maritalStatus: "M",
	raceColor: "03",
	nationality: "BR",
	emergencyContactName: "Pedro Silva",
	emergencyContactRelationship: "filho",
	emergencyContactPhone: "81 3333-4444",
	updatedAt: new Date("2026-11-02T10:00:00Z"),
});

export const ANAMNESIS: Anamnesis = {
	queixa_principal: section("Cefaleia há 3 dias"),
	hda: section("Dor frontal <pulsátil> & piora à tarde.\r\nSem febre."),
	antecedentes: section("Hipertensão arterial"),
	alergias: section("Nega alergias"),
	medicamentos_em_uso: section("Losartana 50 mg"),
	exame_fisico: section("PA 130x85 mmHg"),
	hipoteses: section("Cefaleia tensional?"),
	conduta: section("Analgesia e retorno em 7 dias"),
	historico: section("1 consulta anterior"),
};

export const makeConsultation = (over: Partial<ConsultationRecord> = {}): ConsultationRecord => ({
	id: 10,
	createdAt: new Date("2026-11-05T14:00:00Z"),
	source: "browser",
	status: "done",
	consentAt: new Date("2026-11-05T14:00:00Z"),
	transcript: "Paciente relata dor de cabeça há três dias. Sem febre. Ação.",
	anamnesis: ANAMNESIS,
	engine: "anthropic",
	...over,
});

export const makeExport = (over: Partial<ClinicalRecordExport> = {}): ClinicalRecordExport => ({
	patient: FULL_PATIENT,
	consultations: [makeConsultation()],
	practitioner: { id: "u1", name: "Dra. Ana Souza", email: "ana@example.com" },
	exportedAt: new Date("2026-11-08T12:00:00Z"),
	...over,
});

/** Deterministic RFC 4122-shaped ids: 00000000-0000-4000-8000-000000000001, … */
export function sequentialUuid(): () => string {
	let n = 0;
	return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}
