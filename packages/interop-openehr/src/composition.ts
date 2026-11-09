/**
 * ConsultationRecord → openEHR COMPOSITION (openEHR-EHR-COMPOSITION.encounter.v1).
 *
 * Each anamnesis section is a SECTION.adhoc.v1 renamed to the section
 * title, holding one narrative-capable ENTRY (all CKM-published):
 * reason_for_encounter, story, exam or clinical_synopsis. Archetypes
 * whose mandatory coded elements would assert facts the physician never
 * coded (problem_diagnosis, adverse_reaction_risk, medication_summary)
 * are deliberately not used — KTB documents, the physician decides.
 *
 * No template_id: ARCHETYPED.template_id is optional in RM 1.1.0, but a
 * CDR (EHRbase, Better) only accepts compositions of an uploaded OPT.
 */
import type { AnamnesisSection } from "@ktb/anamnesis";
import type { ConsultationRecord, PractitionerRecord } from "@ktb/interop";

import {
	type Json,
	codePhrase,
	dvDateTime,
	dvOpenehr,
	dvText,
	element,
	itemTree,
	root,
} from "./rm.ts";

export const ENCOUNTER = "openEHR-EHR-COMPOSITION.encounter.v1";
const SECTION = "openEHR-EHR-SECTION.adhoc.v1";
const REASON = "openEHR-EHR-EVALUATION.reason_for_encounter.v1";
const STORY = "openEHR-EHR-OBSERVATION.story.v1";
const EXAM = "openEHR-EHR-OBSERVATION.exam.v1";
const SYNOPSIS = "openEHR-EHR-EVALUATION.clinical_synopsis.v1";

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

type EntryKind = "reason" | "story" | "exam" | "synopsis";

/** Section order, pt-BR titles and the ENTRY archetype that carries the narrative. */
export const SECTIONS: ReadonlyArray<readonly [SectionKey, string, EntryKind]> = [
	["queixa_principal", "Queixa principal", "reason"],
	["hda", "História da doença atual", "story"],
	["antecedentes", "Antecedentes", "story"],
	["alergias", "Alergias", "story"],
	["medicamentos_em_uso", "Medicamentos em uso", "story"],
	["exame_fisico", "Exame físico", "exam"],
	["hipoteses", "Hipóteses diagnósticas", "synopsis"],
	["conduta", "Conduta", "synopsis"],
	["historico", "Histórico de consultas", "synopsis"],
];

/** ENTRY attributes every entry needs (RM: language, encoding, subject). */
const entryHeader = (): Json => ({
	language: codePhrase("ISO_639-1", "pt"),
	encoding: codePhrase("IANA_character-sets", "UTF-8"),
	subject: { _type: "PARTY_SELF" },
});

/** OBSERVATION with one POINT_EVENT holding a single narrative ELEMENT. */
function observation(
	archetype: string,
	name: string,
	elementName: string,
	text: string,
	at: Json,
): Json {
	return {
		_type: "OBSERVATION",
		...root(archetype),
		name: dvText(name),
		...entryHeader(),
		data: {
			_type: "HISTORY",
			archetype_node_id: "at0001",
			name: dvText("Event Series"),
			origin: at,
			events: [
				{
					_type: "POINT_EVENT",
					archetype_node_id: "at0002",
					name: dvText("Any event"),
					time: at,
					data: itemTree("at0003", "Tree", [element("at0004", elementName, dvText(text))]),
				},
			],
		},
	};
}

function evaluation(
	archetype: string,
	name: string,
	nodeId: string,
	elementName: string,
	text: string,
): Json {
	return {
		_type: "EVALUATION",
		...root(archetype),
		name: dvText(name),
		...entryHeader(),
		data: itemTree("at0001", "Tree", [element(nodeId, elementName, dvText(text))]),
	};
}

function entry(kind: EntryKind, text: string, at: Json): Json {
	switch (kind) {
		case "reason":
			return evaluation(REASON, "Reason for encounter", "at0004", "Presenting problem", text);
		case "story":
			return observation(STORY, "Story/History", "Story", text, at);
		case "exam":
			return observation(EXAM, "Physical examination findings", "Description", text, at);
		case "synopsis":
			return evaluation(SYNOPSIS, "Clinical synopsis", "at0002", "Synopsis", text);
	}
}

export function toComposition(
	c: ConsultationRecord,
	practitioner: PractitionerRecord,
	/** OBJECT_VERSION_ID, e.g. "<uuid>::ktbhealth::1". */
	versionUid: string,
): Json {
	const at = dvDateTime(c.createdAt);
	const byKey = (c.anamnesis ?? {}) as Partial<Record<SectionKey, AnamnesisSection>>;
	const content = SECTIONS.flatMap(([key, title, kind]) => {
		const text = byKey[key]?.content.trim();
		if (!text) return [];
		return [
			{ _type: "SECTION", ...root(SECTION), name: dvText(title), items: [entry(kind, text, at)] },
		];
	});
	return {
		_type: "COMPOSITION",
		...root(ENCOUNTER),
		name: dvText("Registro de consulta"),
		uid: { _type: "OBJECT_VERSION_ID", value: versionUid },
		language: codePhrase("ISO_639-1", "pt"),
		territory: codePhrase("ISO_3166-1", "BR"),
		category: dvOpenehr("event", "433"),
		composer: { _type: "PARTY_IDENTIFIED", name: practitioner.name },
		context: {
			_type: "EVENT_CONTEXT",
			start_time: at,
			setting: dvOpenehr("primary medical care", "228"),
		},
		...(content.length ? { content } : {}),
	};
}
