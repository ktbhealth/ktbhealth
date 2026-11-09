/**
 * ConsultationRecord → FHIR R4 Encounter + Composition (+ transcript
 * DocumentReference and a Provenance naming the drafting software).
 *
 * The note is free text the physician reviews, so each anamnesis section
 * becomes a narrative-only Composition.section (cmp-1 is met by `text`)
 * with its LOINC section code — no Condition/AllergyIntolerance entries
 * are synthesized: KTB documents, the physician decides. There is no
 * sign-off flow yet, hence `status: preliminary` and no attester.
 *
 * BR Core Encounter (needs serviceProvider/priority) and the RNDS RAC
 * profile (draft; forbids narrative, requires coded diagnoses) are not
 * claimed.
 */
import type { AnamnesisSection } from "@ktb/anamnesis";
import type { ConsultationRecord } from "@ktb/interop";

import type { CodeableConcept, Coding, Narrative, Reference, Resource } from "./types.ts";

const LOINC = "http://loinc.org";

/** LOINC 34108-1 — the document type for a general outpatient visit note. */
export const NOTE_TYPE: Coding = { system: LOINC, code: "34108-1", display: "Outpatient Note" };

type SectionKey =
	| "queixa_principal"
	| "hda"
	| "antecedentes"
	| "alergias"
	| "medicamentos_em_uso"
	| "exame_fisico"
	| "hipoteses"
	| "conduta"
	| "historico";

/** Section order, pt-BR titles (the note's language) and LOINC section codes. */
export const SECTIONS: ReadonlyArray<readonly [SectionKey, string, Coding]> = [
	[
		"queixa_principal",
		"Queixa principal",
		{ system: LOINC, code: "10154-3", display: "Chief complaint Narrative - Reported" },
	],
	[
		"hda",
		"História da doença atual",
		{ system: LOINC, code: "10164-2", display: "History of Present illness Narrative" },
	],
	[
		"antecedentes",
		"Antecedentes",
		{ system: LOINC, code: "11348-0", display: "History of Past illness note" },
	],
	[
		"alergias",
		"Alergias",
		{ system: LOINC, code: "48765-2", display: "Allergies and adverse reactions Document" },
	],
	[
		"medicamentos_em_uso",
		"Medicamentos em uso",
		{ system: LOINC, code: "10160-0", display: "History of Medication use Narrative" },
	],
	[
		"exame_fisico",
		"Exame físico",
		{ system: LOINC, code: "29545-1", display: "Physical findings note" },
	],
	[
		"hipoteses",
		"Hipóteses diagnósticas",
		{ system: LOINC, code: "51848-0", display: "Evaluation Note" },
	],
	["conduta", "Conduta", { system: LOINC, code: "18776-5", display: "Plan of Care Note" }],
	[
		"historico",
		"Histórico de consultas",
		{
			system: LOINC,
			code: "46240-8",
			display: "History of Hospitalizations+Outpatient visits Narrative",
		},
	],
];

const ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode";
const PARTICIPANT_TYPE = "http://terminology.hl7.org/CodeSystem/provenance-participant-type";
const OBSERVATION_VALUE = "http://terminology.hl7.org/CodeSystem/v3-ObservationValue";

/** Rule-based extraction is software, but not AI; every other engine is an LLM. */
export const isAiEngine = (engine: string | null): boolean =>
	engine !== null && engine !== "heuristic";

const escapeXml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Free text → XHTML narrative, one paragraph per line. */
export function narrative(text: string): Narrative {
	const paragraphs = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => `<p>${escapeXml(l)}</p>`)
		.join("");
	// "additional": human text not derived from structured elements.
	return {
		status: "additional",
		div: `<div xmlns="http://www.w3.org/1999/xhtml">${paragraphs}</div>`,
	};
}

/** UTF-8 → base64 without Node's Buffer (runs on Workers too). */
export function base64Utf8(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

export interface ConsultationRefs {
	readonly patient: Reference;
	readonly practitioner: Reference;
	/** Device that drafted the note, when an engine is recorded. */
	readonly device: Reference | null;
	readonly ids: {
		readonly encounter: string;
		readonly composition: string;
		readonly transcript: string;
		readonly provenance: string;
	};
}

const ref = (id: string): Reference => ({ reference: `urn:uuid:${id}` });

/** Captured by the meeting bot → telemedicine (VR); otherwise ambulatory (AMB). */
const encounterClass = (source: string): Coding =>
	source === "bot"
		? { system: ACT_CODE, code: "VR", display: "virtual" }
		: { system: ACT_CODE, code: "AMB", display: "ambulatory" };

function sections(c: ConsultationRecord) {
	const a = c.anamnesis;
	if (!a) return [];
	const byKey = a as unknown as Partial<Record<SectionKey, AnamnesisSection>>;
	return SECTIONS.flatMap(([key, title, code]) => {
		const content = byKey[key]?.content.trim();
		return content
			? [{ title, code: { coding: [code] } as CodeableConcept, text: narrative(content) }]
			: [];
	});
}

export function consultationResources(c: ConsultationRecord, r: ConsultationRefs): Resource[] {
	const start = c.createdAt.toISOString();
	const ai = isAiEngine(c.engine);
	const noteSections = sections(c);
	const encounter = {
		resourceType: "Encounter",
		id: r.ids.encounter,
		status: c.status === "live" ? "in-progress" : "finished",
		class: encounterClass(c.source),
		subject: r.patient,
		participant: [{ individual: r.practitioner }],
		period: { start },
	};
	const hasTranscript = c.transcript.trim() !== "";
	const transcript = hasTranscript
		? {
				resourceType: "DocumentReference",
				id: r.ids.transcript,
				status: "current",
				// Machine transcription, not physician-verified.
				docStatus: "preliminary",
				type: { text: "Transcrição da consulta" },
				subject: r.patient,
				date: start,
				author: [r.practitioner],
				content: [
					{
						attachment: {
							contentType: "text/plain; charset=utf-8",
							language: "pt-BR",
							data: base64Utf8(c.transcript),
						},
					},
				],
				context: { encounter: [ref(r.ids.encounter)] },
			}
		: null;
	const composition = {
		resourceType: "Composition",
		id: r.ids.composition,
		...(ai
			? {
					meta: {
						security: [
							{
								system: OBSERVATION_VALUE,
								code: "AIAST",
								display: "Artificial Intelligence asserted",
							},
						],
					},
				}
			: {}),
		language: "pt-BR",
		status: "preliminary",
		type: { coding: [NOTE_TYPE] },
		subject: r.patient,
		encounter: ref(r.ids.encounter),
		date: start,
		author: [r.practitioner],
		title: "Registro de consulta",
		// FHIR JSON forbids empty arrays: a note with no content has no sections.
		...(noteSections.length ? { section: noteSections } : {}),
	};
	const provenance = r.device
		? {
				resourceType: "Provenance",
				id: r.ids.provenance,
				target: [ref(r.ids.composition)],
				recorded: start,
				agent: [
					{
						type: { coding: [{ system: PARTICIPANT_TYPE, code: "author" }] },
						who: r.practitioner,
					},
					{
						type: { coding: [{ system: PARTICIPANT_TYPE, code: "assembler" }] },
						who: r.device,
					},
				],
				...(transcript ? { entity: [{ role: "derivation", what: ref(r.ids.transcript) }] } : {}),
			}
		: null;
	return [
		encounter,
		composition,
		...(transcript ? [transcript] : []),
		...(provenance ? [provenance] : []),
	];
}
