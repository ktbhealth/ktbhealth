/**
 * PatientRecord → FHIR R4 Patient, following HL7 Brasil BR Core 1.7.1
 * (`br.gov.saude.br-core.fhir`), which supersedes the legacy RNDS
 * BRIndividuo-1.0 profiles. Elements BR Core does not profile use the
 * base R4 bindings and HL7 core extensions.
 *
 * `meta.profile` claims BR Core only when the record meets its hard
 * requirements (gender 1..1; CPF or CNS — br-core-pat-2). Incomplete
 * records are still exported, as plain R4.
 */
import type { PatientRecord } from "@ktb/interop";

import type { CodeableConcept, Extension, HumanName, Identifier, Patient } from "./types.ts";

export const BR_CORE_PATIENT =
	"https://br-core.saude.gov.br/fhir/StructureDefinition/br-core-patient";

const SYSTEMS = {
	cpf: "https://saude.gov.br/fhir/sid/cpf",
	cns: "https://saude.gov.br/fhir/sid/cns",
	identifierType: "http://terminology.hl7.org/CodeSystem/v2-0203",
	raceColor: "https://terminologia.saude.gov.br/fhir/CodeSystem/BRRacaCor",
	maritalStatus: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
	nullFlavor: "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
	roleCode: "http://terminology.hl7.org/CodeSystem/v3-RoleCode",
	contactRole: "http://terminology.hl7.org/CodeSystem/v2-0131",
	iso3166: "urn:iso:std:iso:3166",
	bcp47: "urn:ietf:bcp:47",
} as const;

const EXTENSIONS = {
	raceColor: "https://ips.saude.gov.br/fhir/StructureDefinition/raca-br-ips",
	nationality: "http://hl7.org/fhir/StructureDefinition/patient-nationality",
} as const;

/** BRRacaCor displays (terminologia.saude.gov.br). */
const RACE_COLOR_DISPLAY: Record<string, string> = {
	"01": "Branca",
	"02": "Preta",
	"03": "Parda",
	"04": "Amarela",
	"05": "Indígena",
	"99": "Sem informação",
};

/** R4 marital-status ValueSet displays; UNK comes from v3-NullFlavor. */
const MARITAL_DISPLAY: Record<string, string> = {
	S: "Never Married",
	M: "Married",
	T: "Domestic partner",
	L: "Legally Separated",
	D: "Divorced",
	W: "Widowed",
	UNK: "unknown",
};

const identifierType = (code: string): CodeableConcept => ({
	coding: [{ system: SYSTEMS.identifierType, code }],
});

function identifiers(p: PatientRecord): Identifier[] {
	const out: Identifier[] = [];
	if (p.cpf)
		out.push({ use: "official", type: identifierType("TAX"), system: SYSTEMS.cpf, value: p.cpf });
	if (p.cns)
		out.push({ use: "official", type: identifierType("HC"), system: SYSTEMS.cns, value: p.cns });
	// Issuing country is not recorded, so no passport-{country} system.
	if (p.passport) out.push({ type: identifierType("PPN"), value: p.passport });
	return out;
}

function names(p: PatientRecord): HumanName[] {
	const official: HumanName = { use: "official", text: p.name };
	// BR Core CadSUS mapping: nome social → HumanName.use = usual.
	return p.socialName ? [official, { use: "usual", text: p.socialName }] : [official];
}

function extensions(p: PatientRecord): Extension[] {
	const out: Extension[] = [];
	const race = p.raceColor ? RACE_COLOR_DISPLAY[p.raceColor] : undefined;
	if (p.raceColor && race)
		out.push({
			url: EXTENSIONS.raceColor,
			valueCodeableConcept: {
				coding: [{ system: SYSTEMS.raceColor, code: p.raceColor, display: race }],
			},
		});
	if (p.nationality)
		out.push({
			url: EXTENSIONS.nationality,
			extension: [
				{
					url: "code",
					valueCodeableConcept: { coding: [{ system: SYSTEMS.iso3166, code: p.nationality }] },
				},
			],
		});
	return out;
}

function maritalStatus(code: string | null): CodeableConcept | undefined {
	const display = code ? MARITAL_DISPLAY[code] : undefined;
	if (!code || !display) return undefined;
	const system = code === "UNK" ? SYSTEMS.nullFlavor : SYSTEMS.maritalStatus;
	return { coding: [{ system, code, display }] };
}

function address(p: PatientRecord): Patient["address"] {
	const street = [p.addressLine, p.addressNumber].filter(Boolean).join(", ");
	const line = [street, p.addressComplement].filter((l): l is string => Boolean(l));
	const parts = {
		...(line.length ? { line } : {}),
		...(p.district ? { district: p.district } : {}),
		...(p.city ? { city: p.city } : {}),
		...(p.state ? { state: p.state } : {}),
		...(p.postalCode ? { postalCode: p.postalCode } : {}),
		...(p.country ? { country: p.country } : {}),
	};
	return Object.keys(parts).length ? [{ use: "home", ...parts }] : undefined;
}

function contacts(p: PatientRecord): Patient["contact"] {
	const out: Array<NonNullable<Patient["contact"]>[number]> = [];
	// Mother's full name (not patient-mothersMaidenName, which is her maiden name).
	if (p.motherName)
		out.push({
			relationship: [{ coding: [{ system: SYSTEMS.roleCode, code: "MTH" }] }],
			name: { text: p.motherName },
		});
	if (p.emergencyContactName || p.emergencyContactPhone)
		out.push({
			relationship: [
				{ coding: [{ system: SYSTEMS.contactRole, code: "C" }] },
				...(p.emergencyContactRelationship ? [{ text: p.emergencyContactRelationship }] : []),
			],
			...(p.emergencyContactName ? { name: { text: p.emergencyContactName } } : {}),
			...(p.emergencyContactPhone
				? { telecom: [{ system: "phone" as const, value: p.emergencyContactPhone }] }
				: {}),
		});
	return out.length ? out : undefined;
}

/** True when the record satisfies BR Core Patient's mandatory elements. */
export const meetsBrCore = (p: PatientRecord): boolean =>
	p.gender !== null && (p.cpf !== null || p.cns !== null);

export function toPatient(p: PatientRecord, id: string): Patient {
	const ext = extensions(p);
	const ids = identifiers(p);
	const telecom = [
		...(p.phone ? [{ system: "phone" as const, value: p.phone }] : []),
		...(p.email ? [{ system: "email" as const, value: p.email }] : []),
	];
	const marital = maritalStatus(p.maritalStatus);
	const addr = address(p);
	const contact = contacts(p);
	return {
		resourceType: "Patient",
		id,
		...(meetsBrCore(p) ? { meta: { profile: [BR_CORE_PATIENT] } } : {}),
		...(ext.length ? { extension: ext } : {}),
		...(ids.length ? { identifier: ids } : {}),
		active: p.active,
		name: names(p),
		...(telecom.length ? { telecom } : {}),
		...(p.gender ? { gender: p.gender } : {}),
		...(p.birthDate ? { birthDate: p.birthDate } : {}),
		...(addr ? { address: addr } : {}),
		...(marital ? { maritalStatus: marital } : {}),
		...(contact ? { contact } : {}),
		...(p.preferredLanguage
			? {
					communication: [
						{
							language: { coding: [{ system: SYSTEMS.bcp47, code: p.preferredLanguage }] },
							preferred: true,
						},
					],
				}
			: {}),
	};
}
