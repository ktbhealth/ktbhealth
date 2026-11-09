import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Ajv, type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

import {
	ANAMNESIS,
	FULL_PATIENT,
	makeConsultation,
	makeExport,
	makePatientRecord,
	sequentialUuid,
} from "@ktb/interop/testing";

import {
	DEVIATIONS,
	ENCOUNTER,
	openEhrExporter,
	SECTIONS,
	SYSTEM_ID,
	toOpenEhrExtract,
} from "./index.ts";

// Official openEHR ITS-JSON schema for RM 1.1.0 (see conformance/README.md).
const schema = JSON.parse(
	gunzipSync(
		readFileSync(new URL("../conformance/openehr_rm_1.1.0_all.json.gz", import.meta.url)),
	).toString(),
) as { $id: string };
const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
ajv.addSchema(schema);
/** Any RM root object (PERSON, EHR_STATUS, COMPOSITION, …), dispatched on `_type`. */
const validateRoot = ajv.getSchema(schema.$id) as ValidateFunction;
const validateExtract = ajv.compile({ $ref: `${schema.$id}#/definitions/EXTRACT` });

type Json = Record<string, any>;
const extractOf = (input = makeExport()) =>
	JSON.parse(openEhrExporter.render(input, { uuid: sequentialUuid() })) as Json;
const items = (x: Json): Json[] => x.chapters[0].items;
const versioned = (x: Json, kind: string) => items(x).filter((i) => i.item._type === kind);
const data = (item: Json): Json => item.item.versions[0].data;
const element = (tree: Json, nodeId: string): Json | undefined =>
	tree.items.find((i: Json) => i.archetype_node_id === nodeId);

describe("openEHR RM 1.1.0 conformance", () => {
	it.each([
		["a complete record with consultations", makeExport()],
		[
			"a name-only record without consultations",
			makeExport({ patient: makePatientRecord(), consultations: [] }),
		],
	])("validates %s as an EXTRACT and every versioned object as RM", (_label, input) => {
		const x = extractOf(input);
		validateExtract(x);
		expect(validateExtract.errors ?? null).toBeNull();
		for (const item of items(x)) {
			// ORIGINAL_VERSION.data is untyped in the schema — validate each payload as a root.
			validateRoot(data(item));
			expect(validateRoot.errors ?? null).toBeNull();
		}
	});

	it("is a real check: the schema rejects an invalid PERSON and COMPOSITION", () => {
		const x = extractOf();
		const person = data(versioned(x, "X_VERSIONED_PARTY")[0]!);
		expect(validateRoot({ ...person, identities: [] })).toBe(false);
		const composition = data(versioned(x, "X_VERSIONED_COMPOSITION")[0]!);
		const { language: _drop, ...noLanguage } = composition;
		expect(validateRoot(noLanguage)).toBe(false);
	});

	it("wraps single-version objects with audit, lifecycle and a shared contribution", () => {
		const x = extractOf();
		expect(x._type).toBe("EXTRACT");
		expect(x.time_created.value).toBe("2026-11-08T12:00:00.000Z");
		const versions = items(x).map((i) => i.item.versions[0]);
		expect(new Set(versions.map((v) => v.contribution.id.value)).size).toBe(1);
		for (const v of versions) {
			expect(v.uid.value).toMatch(new RegExp(`::${SYSTEM_ID}::1$`));
			expect(v.commit_audit.change_type.defining_code.code_string).toBe("249");
			expect(v.commit_audit.committer.name).toBe("Dra. Ana Souza");
		}
		expect(items(x).filter((i) => i.is_primary)).toHaveLength(1);
		expect(openEhrExporter.mediaType).toBe("application/json");
		expect(openEhrExporter.fileSuffix).toBe("openehr.json");
	});

	it("links the EHR to the patient PERSON via PARTY_SELF.external_ref", () => {
		const x = extractOf();
		const person = data(versioned(x, "X_VERSIONED_PARTY")[0]!);
		const status = data(versioned(x, "X_VERSIONED_EHR_STATUS")[0]!);
		expect(status.subject.external_ref).toEqual({
			_type: "PARTY_REF",
			id: { _type: "HIER_OBJECT_ID", value: person.uid.value },
			namespace: "demographic",
			type: "PERSON",
		});
		const ehrId = x.chapters[0].extract_id_key;
		for (const item of [
			...versioned(x, "X_VERSIONED_EHR_STATUS"),
			...versioned(x, "X_VERSIONED_COMPOSITION"),
		])
			expect(item.item.owner_id.id.value).toBe(ehrId);
	});

	it("defaults to random UUIDs", () => {
		expect((toOpenEhrExtract(makeExport()).uid as Json).value).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe("demographic PERSON", () => {
	const x = extractOf();
	const person = data(versioned(x, "X_VERSIONED_PARTY")[0]!);
	const details = person.details;

	it("roots on the CKM person archetype with RM 1.1.0 archetype details", () => {
		expect(person.archetype_node_id).toBe("openEHR-DEMOGRAPHIC-PERSON.person.v0");
		expect(person.archetype_details.rm_version).toBe("1.1.0");
		expect(person.name.value).toBe("Cida");
		expect(person.languages).toEqual([{ _type: "DV_TEXT", value: "pt-BR" }]);
	});

	it("keeps the legal name and the preferred social name as identities", () => {
		expect(
			person.identities.map((i: Json) => [
				i.name.defining_code.code_string,
				element(i.details, "at0010")!.value.value,
				element(i.details, "at0008")!.value.value,
			]),
		).toEqual([
			["at0027", "Maria Aparecida Silva", false],
			["at0028", "Cida", true],
		]);
		const plain = data(
			versioned(extractOf(makeExport({ patient: makePatientRecord() })), "X_VERSIONED_PARTY")[0]!,
		);
		expect(plain.identities).toHaveLength(1);
		expect(element(plain.identities[0].details, "at0008")!.value.value).toBe(true);
	});

	it("records birth date, gender, marital status and race/color in person_details", () => {
		expect(element(element(details, "at0001")!, "at0010")!.value).toEqual({
			_type: "DV_DATE",
			value: "1984-03-05",
		});
		expect(element(details, "at0031")!.value.defining_code.code_string).toBe("at0311");
		expect(element(details, "at0033")!.value.defining_code).toEqual({
			_type: "CODE_PHRASE",
			terminology_id: {
				_type: "TERMINOLOGY_ID",
				value: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
			},
			code_string: "M",
		});
		expect(element(details, "at0034")!.value).toMatchObject({ value: "Parda" });
	});

	it("puts CPF, CNS and passport in person_identifier clusters, not identities", () => {
		const ids = details.items.filter(
			(i: Json) => i.archetype_node_id === "openEHR-DEMOGRAPHIC-CLUSTER.person_identifier.v0",
		);
		expect(ids.map((c: Json) => element(c, "at0001")!.value)).toEqual([
			{
				_type: "DV_IDENTIFIER",
				id: "52998224725",
				type: "CPF",
				issuer: "Receita Federal do Brasil",
			},
			{ _type: "DV_IDENTIFIER", id: "100000000000007", type: "CNS", issuer: "Ministério da Saúde" },
			{ _type: "DV_IDENTIFIER", id: "FX123456", type: "Passport" },
		]);
		expect(element(ids[0], "at0002")!.value.defining_code.code_string).toBe("at0013");
		expect(element(ids[2], "at0002")!.value).toEqual({ _type: "DV_TEXT", value: "Unknown" });
	});

	it("collects the residential address, phone and e-mail in one CONTACT", () => {
		const [contact] = person.contacts;
		expect(contact.addresses.map((a: Json) => a.name.value)).toEqual([
			"Residential",
			"Telephone",
			"E-mail",
		]);
		const postal = contact.addresses[0].details;
		expect(element(element(postal, "at0002")!, "at0028")!.value.value).toBe("Rua da Aurora");
		expect(element(postal, "at0007")!.value.value).toBe("Recife");
		expect(element(postal, "at0009")!.value.defining_code.code_string).toBe("BR");
	});

	it("relates the mother and the emergency contact as separate PERSONs", () => {
		const parties = versioned(x, "X_VERSIONED_PARTY").map(data);
		expect(parties.map((p) => p.name.value)).toEqual(["Cida", "Josefa Silva", "Pedro Silva"]);
		expect(
			person.relationships.map((r: Json) => [
				r.name.value,
				element(r.details, "at0040")!.value.value,
				r.target.id.value,
			]),
		).toEqual([
			["Mother", "mother", parties[1]!.uid.value],
			["Emergency contact", "filho", parties[2]!.uid.value],
		]);
		expect(parties[1]!.contacts).toBeUndefined();
		expect(parties[2]!.contacts[0].addresses[0].name.value).toBe("Telephone");
		const generic = data(
			versioned(
				extractOf(makeExport({ patient: makePatientRecord({ emergencyContactName: "Ana" }) })),
				"X_VERSIONED_PARTY",
			)[0]!,
		);
		expect(element(generic.relationships[0].details, "at0040")!.value.value).toBe(
			"emergency contact",
		);
	});

	it("maps gender edge cases and skips unknown codes", () => {
		const genderOf = (gender: string) =>
			element(
				data(
					versioned(
						extractOf(makeExport({ patient: makePatientRecord({ gender }) })),
						"X_VERSIONED_PARTY",
					)[0]!,
				).details,
				"at0031",
			)!.value;
		expect(genderOf("male").defining_code.code_string).toBe("at0310");
		expect(genderOf("unknown").defining_code.code_string).toBe("at0313");
		expect(genderOf("other")).toEqual({ _type: "DV_TEXT", value: "other" });

		const odd = data(
			versioned(
				extractOf(
					makeExport({ patient: makePatientRecord({ maritalStatus: "X", raceColor: "77" }) }),
				),
				"X_VERSIONED_PARTY",
			)[0]!,
		);
		expect(odd.details.items).toEqual([]);
		const unk = data(
			versioned(
				extractOf(makeExport({ patient: makePatientRecord({ maritalStatus: "UNK" }) })),
				"X_VERSIONED_PARTY",
			)[0]!,
		);
		expect(element(unk.details, "at0033")!.value.defining_code.terminology_id.value).toBe(
			"http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
		);
	});

	it("emits a contact-free PERSON for a name-only record and a partial address otherwise", () => {
		const plain = data(
			versioned(extractOf(makeExport({ patient: makePatientRecord() })), "X_VERSIONED_PARTY")[0]!,
		);
		expect(plain.contacts).toBeUndefined();
		expect(plain.relationships).toBeUndefined();
		expect(plain.languages).toBeUndefined();
		const partial = data(
			versioned(
				extractOf(makeExport({ patient: makePatientRecord({ addressNumber: "9" }) })),
				"X_VERSIONED_PARTY",
			)[0]!,
		);
		expect(partial.contacts[0].addresses[0].details.items).toHaveLength(1);
	});

	it("documents its deviations from the draft archetypes", () => {
		expect(DEVIATIONS.length).toBeGreaterThan(0);
		expect(FULL_PATIENT.nationality).toBe("BR");
	});
});

describe("encounter COMPOSITION", () => {
	const x = extractOf();
	const [item] = versioned(x, "X_VERSIONED_COMPOSITION");
	const composition = data(item!);

	it("is an event composition in primary care, pt / BR", () => {
		expect(composition.archetype_node_id).toBe(ENCOUNTER);
		expect(composition.category.defining_code).toMatchObject({ code_string: "433" });
		expect(composition.context.setting.defining_code).toMatchObject({ code_string: "228" });
		expect(composition.language.code_string).toBe("pt");
		expect(composition.territory.code_string).toBe("BR");
		expect(composition.composer).toEqual({ _type: "PARTY_IDENTIFIED", name: "Dra. Ana Souza" });
		expect(composition.context.start_time.value).toBe("2026-11-05T14:00:00.000Z");
		expect(composition.uid.value).toBe(item!.item.versions[0].uid.value);
	});

	it("commits drafts as incomplete, naming the drafting engine", () => {
		const version = item!.item.versions[0];
		expect(version.lifecycle_state.defining_code.code_string).toBe("553");
		expect(version.commit_audit.description.value).toContain("anthropic");
		const manual = versioned(
			extractOf(makeExport({ consultations: [makeConsultation({ engine: null })] })),
			"X_VERSIONED_COMPOSITION",
		)[0]!;
		expect(manual.item.versions[0].commit_audit.description.value).toBe(
			"Physician-editable consultation record; not signed off.",
		);
	});

	it("keeps one narrative SECTION per anamnesis section, in record order", () => {
		expect(composition.content.map((s: Json) => s.name.value)).toEqual(
			SECTIONS.map(([, title]) => title),
		);
		const archetypes = composition.content.map((s: Json) => s.items[0].archetype_node_id);
		expect(archetypes).toEqual([
			"openEHR-EHR-EVALUATION.reason_for_encounter.v1",
			"openEHR-EHR-OBSERVATION.story.v1",
			"openEHR-EHR-OBSERVATION.story.v1",
			"openEHR-EHR-OBSERVATION.story.v1",
			"openEHR-EHR-OBSERVATION.story.v1",
			"openEHR-EHR-OBSERVATION.exam.v1",
			"openEHR-EHR-EVALUATION.clinical_synopsis.v1",
			"openEHR-EHR-EVALUATION.clinical_synopsis.v1",
			"openEHR-EHR-EVALUATION.clinical_synopsis.v1",
		]);
		const story = composition.content[1].items[0];
		expect(story.data.events[0].data.items[0]).toEqual({
			_type: "ELEMENT",
			archetype_node_id: "at0004",
			name: { _type: "DV_TEXT", value: "Story" },
			value: { _type: "DV_TEXT", value: ANAMNESIS.hda.content },
		});
		expect(story.subject).toEqual({ _type: "PARTY_SELF" });
		expect(composition.content[0].items[0].data.items[0].archetype_node_id).toBe("at0004");
	});

	it("skips blank sections and has no content without an anamnesis", () => {
		const [blank, none] = versioned(
			extractOf(
				makeExport({
					consultations: [
						makeConsultation({
							anamnesis: { ...ANAMNESIS, conduta: { ...ANAMNESIS.conduta, content: "  " } },
						}),
						makeConsultation({ id: 11, anamnesis: null }),
					],
				}),
			),
			"X_VERSIONED_COMPOSITION",
		).map(data);
		expect(blank!.content.map((s: Json) => s.name.value)).not.toContain("Conduta");
		expect(none!.content).toBeUndefined();
	});
});
