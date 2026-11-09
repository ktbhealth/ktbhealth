/**
 * PatientRecord → openEHR demographic PERSON (RM 1.1.0 rm.demographic),
 * built on the CKM demographic archetypes. All of them are v0 drafts —
 * there are no published openEHR demographic archetypes — so the export
 * follows them where the record fits and deviates, deliberately, where
 * they cannot hold Brazilian registry data (see `DEVIATIONS`).
 *
 * State-issued identifiers (CPF, CNS, passport) live in PERSON.details,
 * not identities: the RM reserves PARTY_IDENTITY for names.
 */
import type { PatientRecord } from "@ktb/interop";

import {
	type Json,
	cluster,
	dvBoolean,
	dvCoded,
	dvDate,
	dvLocal,
	dvText,
	element,
	hierId,
	itemTree,
	partyRef,
	root,
} from "./rm.ts";

const ARCHETYPES = {
	person: "openEHR-DEMOGRAPHIC-PERSON.person.v0",
	personName: "openEHR-DEMOGRAPHIC-PARTY_IDENTITY.person_name.v0",
	personDetails: "openEHR-DEMOGRAPHIC-ITEM_TREE.person_details.v0",
	personIdentifier: "openEHR-DEMOGRAPHIC-CLUSTER.person_identifier.v0",
	address: "openEHR-DEMOGRAPHIC-ADDRESS.address.v0",
	electronic: "openEHR-DEMOGRAPHIC-ADDRESS.electronic_communication.v0",
} as const;

/** External terminologies, named by their FHIR canonical URIs (same codes as the FHIR export). */
const TERMINOLOGIES = {
	raceColor: "https://terminologia.saude.gov.br/fhir/CodeSystem/BRRacaCor",
	maritalStatus: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
	nullFlavor: "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
	country: "ISO_3166-1",
} as const;

/**
 * Where this export knowingly departs from the v0 draft archetypes (or
 * leaves data out because no archetype carries it) — documented so a
 * receiver is not surprised.
 */
export const DEVIATIONS = [
	"person.v0 allows one PARTY_IDENTITY: a social name is a second identity (name 'Other name', preferred).",
	"person.v0 allows one ADDRESS per CONTACT: residential address, phone and e-mail share one CONTACT.",
	"Related persons (mother, emergency contact) are PERSONs referenced by PARTY_RELATIONSHIP and carry only a name identity (no person_details).",
	"Not represented (no demographic archetype element): nationality, record active flag.",
] as const;

const GENDER: Record<string, readonly [code: string, text: string]> = {
	male: ["at0310", "Male"],
	female: ["at0311", "Female"],
	unknown: ["at0313", "Not declared/inadequately described"],
};

const RACE_COLOR: Record<string, string> = {
	"01": "Branca",
	"02": "Preta",
	"03": "Parda",
	"04": "Amarela",
	"05": "Indígena",
	"99": "Sem informação",
};

const MARITAL: Record<string, string> = {
	S: "Never Married",
	M: "Married",
	T: "Domestic partner",
	L: "Legally Separated",
	D: "Divorced",
	W: "Widowed",
	UNK: "unknown",
};

/** PARTY_IDENTITY (person_name.v0) holding a full name. */
function nameIdentity(
	fullName: string,
	kind: readonly [code: string, text: string],
	preferred: boolean,
): Json {
	return {
		_type: "PARTY_IDENTITY",
		...root(ARCHETYPES.personName),
		name: dvLocal(kind[1], kind[0]),
		details: itemTree("at0001", "Name", [
			element("at0010", "Full Name", dvText(fullName)),
			element("at0008", "Preferred name", dvBoolean(preferred)),
		]),
	};
}

const LEGAL_NAME = ["at0027", "Legal name"] as const;
const OTHER_NAME = ["at0028", "Other name"] as const;

function identities(p: PatientRecord): Json[] {
	if (!p.socialName) return [nameIdentity(p.name, LEGAL_NAME, true)];
	// Social name is the name the person goes by (BR Decree 8.727/2016).
	return [nameIdentity(p.name, LEGAL_NAME, false), nameIdentity(p.socialName, OTHER_NAME, true)];
}

function identifier(id: string, type: string, issuer: string | null, national: boolean): Json {
	return {
		_type: "CLUSTER",
		...root(ARCHETYPES.personIdentifier),
		name: dvText("Person identifier"),
		items: [
			element("at0001", "Identifier main data", {
				_type: "DV_IDENTIFIER",
				id,
				type,
				...(issuer ? { issuer } : {}),
			}),
			element(
				"at0002",
				"Geographic scope",
				national ? dvLocal("National", "at0013") : dvText("Unknown"),
			),
			...(national
				? [element("at0005", "Issuing Country", dvCoded("Brasil", TERMINOLOGIES.country, "BR"))]
				: []),
		],
	};
}

function details(p: PatientRecord): Json {
	const items: Json[] = [];
	if (p.birthDate)
		items.push(
			// Partial ISO 8601 dates ("1984") are valid DV_DATE values for approximate birth dates.
			cluster("at0001", "Birth data", [element("at0010", "Birth date", dvDate(p.birthDate))]),
		);
	const gender = p.gender ? GENDER[p.gender] : undefined;
	if (gender) items.push(element("at0031", "Gender", dvLocal(gender[1], gender[0])));
	else if (p.gender) items.push(element("at0031", "Gender", dvText(p.gender)));
	const marital = p.maritalStatus ? MARITAL[p.maritalStatus] : undefined;
	if (p.maritalStatus && marital)
		items.push(
			element(
				"at0033",
				"Marital status",
				dvCoded(
					marital,
					p.maritalStatus === "UNK" ? TERMINOLOGIES.nullFlavor : TERMINOLOGIES.maritalStatus,
					p.maritalStatus,
				),
			),
		);
	const race = p.raceColor ? RACE_COLOR[p.raceColor] : undefined;
	if (p.raceColor && race)
		items.push(
			element("at0034", "Ethnic background", dvCoded(race, TERMINOLOGIES.raceColor, p.raceColor)),
		);
	if (p.cpf) items.push(identifier(p.cpf, "CPF", "Receita Federal do Brasil", true));
	if (p.cns) items.push(identifier(p.cns, "CNS", "Ministério da Saúde", true));
	if (p.passport) items.push(identifier(p.passport, "Passport", null, false));
	return {
		_type: "ITEM_TREE",
		...root(ARCHETYPES.personDetails),
		name: dvText("Person data"),
		items,
	};
}

function electronic(kind: readonly [code: string, text: string], value: string): Json {
	return {
		_type: "ADDRESS",
		...root(ARCHETYPES.electronic),
		name: dvLocal(kind[1], kind[0]),
		details: itemTree("at0001", "Components", [element("at0007", "Details", dvText(value))]),
	};
}

const TELEPHONE = ["at0020", "Telephone"] as const;
const EMAIL = ["at0024", "E-mail"] as const;

function postalAddress(p: PatientRecord): Json | null {
	const lines = [
		p.addressLine ? element("at0028", "Street name", dvText(p.addressLine)) : null,
		p.addressNumber ? element("at0029", "Street number", dvText(p.addressNumber)) : null,
		p.addressComplement
			? element("at0022", "Building/complex sub-unit number", dvText(p.addressComplement))
			: null,
	].filter((e): e is Json => e !== null);
	const items = [
		...(lines.length ? [cluster("at0002", "Address lines", lines)] : []),
		...(p.district ? [element("at0003", "District", dvText(p.district))] : []),
		...(p.postalCode ? [element("at0006", "Postal code (ZIP code)", dvText(p.postalCode))] : []),
		...(p.city ? [element("at0007", "Suburb/town/locality", dvText(p.city))] : []),
		...(p.state ? [element("at0008", "State/territory/province identifier", dvText(p.state))] : []),
		...(p.country
			? [
					element(
						"at0009",
						"Country identifier",
						dvCoded(p.country, TERMINOLOGIES.country, p.country),
					),
				]
			: []),
	];
	if (!items.length) return null;
	return {
		_type: "ADDRESS",
		...root(ARCHETYPES.address),
		name: dvLocal("Residential", "at0464"),
		details: itemTree("at0001", "Items", items),
	};
}

function contacts(addresses: readonly Json[]): Json | undefined {
	if (!addresses.length) return undefined;
	return {
		contacts: [
			{ _type: "CONTACT", archetype_node_id: "at0003", name: dvText("Contacts"), addresses },
		],
	};
}

function patientAddresses(p: PatientRecord): Json[] {
	const postal = postalAddress(p);
	return [
		...(postal ? [postal] : []),
		...(p.phone ? [electronic(TELEPHONE, p.phone)] : []),
		...(p.email ? [electronic(EMAIL, p.email)] : []),
	];
}

/** A related person reduced to what the record holds: a name and maybe a phone. */
export interface RelatedPerson {
	readonly uid: string;
	readonly name: string;
	readonly phone: string | null;
	/** PARTY_RELATIONSHIP name and type, e.g. "Mother" / "mother". */
	readonly relationship: string;
	readonly relationshipType: string;
}

export function relatedPersons(p: PatientRecord, uuid: () => string): RelatedPerson[] {
	const out: RelatedPerson[] = [];
	if (p.motherName)
		out.push({
			uid: uuid(),
			name: p.motherName,
			phone: null,
			relationship: "Mother",
			relationshipType: "mother",
		});
	if (p.emergencyContactName)
		out.push({
			uid: uuid(),
			name: p.emergencyContactName,
			phone: p.emergencyContactPhone,
			relationship: "Emergency contact",
			relationshipType: p.emergencyContactRelationship ?? "emergency contact",
		});
	return out;
}

export function toRelatedPerson(r: RelatedPerson): Json {
	return {
		_type: "PERSON",
		...root(ARCHETYPES.person),
		name: dvText(r.name),
		uid: hierId(r.uid),
		identities: [nameIdentity(r.name, LEGAL_NAME, true)],
		...contacts(r.phone ? [electronic(TELEPHONE, r.phone)] : []),
	};
}

export function toPerson(
	p: PatientRecord,
	uid: string,
	related: readonly RelatedPerson[],
	uuid: () => string,
): Json {
	const relationships = related.map((r) => ({
		_type: "PARTY_RELATIONSHIP",
		archetype_node_id: "at0004",
		name: dvText(r.relationship),
		uid: hierId(uuid()),
		details: itemTree("at0000", "Details", [
			element("at0040", "Relationship type", dvText(r.relationshipType)),
		]),
		source: partyRef(uid),
		target: partyRef(r.uid),
	}));
	return {
		_type: "PERSON",
		...root(ARCHETYPES.person),
		name: dvText(p.socialName ?? p.name),
		uid: hierId(uid),
		identities: identities(p),
		...contacts(patientAddresses(p)),
		details: details(p),
		...(relationships.length ? { relationships } : {}),
		...(p.preferredLanguage ? { languages: [dvText(p.preferredLanguage)] } : {}),
	};
}
