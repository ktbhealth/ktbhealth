import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Ajv } from "ajv";
import draft6 from "ajv/dist/refs/json-schema-draft-06.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
	FULL_PATIENT,
	makeConsultation,
	makeExport,
	makePatientRecord,
	sequentialUuid,
} from "@ktb/interop/testing";

import { base64Utf8, narrative } from "./consultation.ts";
import { BR_CORE_PATIENT, fhirR4Exporter, NOTE_TYPE, SECTIONS, toFhirBundle } from "./index.ts";

// Official HL7 FHIR R4 JSON Schema (see conformance/README.md). Its root
// uses the pre-draft-06 `id` keyword, which Ajv expects as `$id`.
const { id: schemaId, ...schemaBody } = JSON.parse(
	gunzipSync(
		readFileSync(new URL("../conformance/fhir.schema.json.gz", import.meta.url)),
	).toString(),
) as Record<string, unknown>;
const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
ajv.addMetaSchema(draft6);
const validateFhir = ajv.compile({ $id: schemaId as string, ...schemaBody });

type Json = Record<string, any>;
const bundleOf = (input = makeExport()) =>
	JSON.parse(fhirR4Exporter.render(input, { uuid: sequentialUuid() })) as Json;
const resources = (bundle: Json, type: string): Json[] =>
	bundle.entry.map((e: Json) => e.resource).filter((r: Json) => r.resourceType === type);
const only = (bundle: Json, type: string): Json => resources(bundle, type)[0]!;

/** Every `reference` string anywhere in the document. */
const references = (node: unknown): string[] =>
	Array.isArray(node)
		? node.flatMap(references)
		: node && typeof node === "object"
			? Object.entries(node).flatMap(([k, v]) =>
					k === "reference" && typeof v === "string" ? [v] : references(v),
				)
			: [];

/** FHIR JSON forbids empty arrays, empty strings and nulls. */
const emptyValues = (node: unknown, path = "$"): string[] =>
	node === null || node === ""
		? [path]
		: Array.isArray(node)
			? node.length === 0
				? [path]
				: node.flatMap((v, i) => emptyValues(v, `${path}[${i}]`))
			: typeof node === "object"
				? Object.entries(node as object).flatMap(([k, v]) => emptyValues(v, `${path}.${k}`))
				: [];

describe("FHIR R4 conformance", () => {
	it.each([
		["a complete record with consultations", makeExport()],
		[
			"a name-only record without consultations",
			makeExport({ patient: makePatientRecord(), consultations: [] }),
		],
	])("validates %s against the official R4 JSON Schema", (_label, input) => {
		const bundle = bundleOf(input);
		validateFhir(bundle);
		expect(validateFhir.errors ?? null).toBeNull();
		expect(emptyValues(bundle)).toEqual([]);
	});

	it("is a real check: the schema rejects a malformed resource", () => {
		const bundle = bundleOf();
		bundle.entry[0].resource.gender = 42;
		expect(validateFhir(bundle)).toBe(false);
	});

	it("resolves every reference inside the bundle with unique urn:uuid fullUrls (bdl-7)", () => {
		const bundle = bundleOf();
		const fullUrls = bundle.entry.map((e: Json) => e.fullUrl);
		expect(new Set(fullUrls).size).toBe(fullUrls.length);
		for (const e of bundle.entry) expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
		for (const r of references(bundle)) expect(fullUrls).toContain(r);
	});

	it("is a collection stamped with the export time", () => {
		const bundle = bundleOf();
		expect(bundle.type).toBe("collection");
		expect(bundle.timestamp).toBe("2026-11-08T12:00:00.000Z");
		expect(fhirR4Exporter.mediaType).toBe("application/fhir+json");
		expect(fhirR4Exporter.fileSuffix).toBe("fhir-r4.json");
	});

	it("defaults to random UUIDs", () => {
		const bundle = toFhirBundle(makeExport());
		expect(bundle.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});
});

describe("Patient (BR Core 1.7.1)", () => {
	const patient = only(bundleOf(), "Patient");

	it("claims BR Core only when gender and CPF/CNS are present", () => {
		expect(patient.meta.profile).toEqual([BR_CORE_PATIENT]);
		const partial = only(
			bundleOf(makeExport({ patient: makePatientRecord({ gender: "male" }) })),
			"Patient",
		);
		expect(partial.meta).toBeUndefined();
		const cnsOnly = only(
			bundleOf(makeExport({ patient: makePatientRecord({ gender: "male", cns: "1" }) })),
			"Patient",
		);
		expect(cnsOnly.meta.profile).toEqual([BR_CORE_PATIENT]);
	});

	it("uses the national identifier systems and v2-0203 types", () => {
		expect(patient.identifier).toEqual([
			{
				use: "official",
				type: {
					coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "TAX" }],
				},
				system: "https://saude.gov.br/fhir/sid/cpf",
				value: "52998224725",
			},
			{
				use: "official",
				type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "HC" }] },
				system: "https://saude.gov.br/fhir/sid/cns",
				value: "100000000000007",
			},
			{
				type: {
					coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "PPN" }],
				},
				value: "FX123456",
			},
		]);
	});

	it("records the legal name as official and the social name as usual", () => {
		expect(patient.name).toEqual([
			{ use: "official", text: "Maria Aparecida Silva" },
			{ use: "usual", text: "Cida" },
		]);
	});

	it("carries race/color (BR IPS) and nationality (HL7 core) extensions", () => {
		expect(patient.extension).toEqual([
			{
				url: "https://ips.saude.gov.br/fhir/StructureDefinition/raca-br-ips",
				valueCodeableConcept: {
					coding: [
						{
							system: "https://terminologia.saude.gov.br/fhir/CodeSystem/BRRacaCor",
							code: "03",
							display: "Parda",
						},
					],
				},
			},
			{
				url: "http://hl7.org/fhir/StructureDefinition/patient-nationality",
				extension: [
					{
						url: "code",
						valueCodeableConcept: { coding: [{ system: "urn:iso:std:iso:3166", code: "BR" }] },
					},
				],
			},
		]);
	});

	it("maps contact data, address, language and marital status", () => {
		expect(patient.telecom).toEqual([
			{ system: "phone", value: "+55 81 98765-4321" },
			{ system: "email", value: "cida@example.com" },
		]);
		expect(patient.address).toEqual([
			{
				use: "home",
				line: ["Rua da Aurora, 100", "apto 12"],
				district: "Boa Vista",
				city: "Recife",
				state: "PE",
				postalCode: "50050000",
				country: "BR",
			},
		]);
		expect(patient.communication).toEqual([
			{ language: { coding: [{ system: "urn:ietf:bcp:47", code: "pt-BR" }] }, preferred: true },
		]);
		expect(patient.maritalStatus.coding).toEqual([
			{
				system: "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
				code: "M",
				display: "Married",
			},
		]);
		expect(patient.gender).toBe("female");
		expect(patient.birthDate).toBe("1984-03-05");
	});

	it("expresses unknown marital status with v3-NullFlavor UNK", () => {
		const p = only(
			bundleOf(makeExport({ patient: makePatientRecord({ maritalStatus: "UNK" }) })),
			"Patient",
		);
		expect(p.maritalStatus.coding).toEqual([
			{
				system: "http://terminology.hl7.org/CodeSystem/v3-NullFlavor",
				code: "UNK",
				display: "unknown",
			},
		]);
	});

	it("drops codes outside the bound value sets instead of emitting invalid codings", () => {
		const p = only(
			bundleOf(makeExport({ patient: makePatientRecord({ maritalStatus: "X", raceColor: "77" }) })),
			"Patient",
		);
		expect(p.maritalStatus).toBeUndefined();
		expect(p.extension).toBeUndefined();
	});

	it("puts the mother (v3 MTH) and the emergency contact (v2-0131 C) in Patient.contact", () => {
		expect(patient.contact).toEqual([
			{
				relationship: [
					{
						coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-RoleCode", code: "MTH" }],
					},
				],
				name: { text: "Josefa Silva" },
			},
			{
				relationship: [
					{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0131", code: "C" }] },
					{ text: "filho" },
				],
				name: { text: "Pedro Silva" },
				telecom: [{ system: "phone", value: "81 3333-4444" }],
			},
		]);
		const phoneOnly = only(
			bundleOf(
				makeExport({ patient: makePatientRecord({ emergencyContactPhone: "81 3333-4444" }) }),
			),
			"Patient",
		);
		expect(phoneOnly.contact).toEqual([
			{
				relationship: [
					{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0131", code: "C" }] },
				],
				telecom: [{ system: "phone", value: "81 3333-4444" }],
			},
		]);
		const nameOnly = only(
			bundleOf(makeExport({ patient: makePatientRecord({ emergencyContactName: "Ana" }) })),
			"Patient",
		);
		expect(nameOnly.contact[0].telecom).toBeUndefined();
		expect(nameOnly.contact[0].name).toEqual({ text: "Ana" });
	});

	it("emits only what a name-only record holds", () => {
		const p = only(bundleOf(makeExport({ patient: makePatientRecord() })), "Patient");
		expect(p).toEqual({
			resourceType: "Patient",
			id: p.id,
			active: true,
			name: [{ use: "official", text: "Maria Silva" }],
		});
	});

	it("keeps a partial address without empty lines", () => {
		const p = only(
			bundleOf(
				makeExport({ patient: makePatientRecord({ addressComplement: "fundos", city: "Natal" }) }),
			),
			"Patient",
		);
		expect(p.address).toEqual([{ use: "home", line: ["fundos"], city: "Natal" }]);
	});
});

describe("consultations", () => {
	const bundle = bundleOf();
	const composition = only(bundle, "Composition");

	it("documents each consultation as a preliminary Outpatient Note", () => {
		expect(composition.status).toBe("preliminary");
		expect(composition.type.coding).toEqual([NOTE_TYPE]);
		expect(NOTE_TYPE).toEqual({
			system: "http://loinc.org",
			code: "34108-1",
			display: "Outpatient Note",
		});
		expect(composition.language).toBe("pt-BR");
		expect(composition.title).toBe("Registro de consulta");
		expect(composition.date).toBe("2026-11-05T14:00:00.000Z");
		expect(composition.attester).toBeUndefined();
		expect(composition.subject.reference).toBe(`urn:uuid:${only(bundle, "Patient").id}`);
		expect(composition.author[0].reference).toBe(`urn:uuid:${only(bundle, "Practitioner").id}`);
	});

	it("keeps sections as narrative-only, LOINC-coded, in record order (cmp-1)", () => {
		expect(composition.section.map((s: Json) => s.code.coding[0].code)).toEqual(
			SECTIONS.map(([, , code]) => code.code),
		);
		for (const s of composition.section) {
			expect(s.entry).toBeUndefined();
			expect(s.text.status).toBe("additional");
			expect(s.text.div).toMatch(/^<div xmlns="http:\/\/www\.w3\.org\/1999\/xhtml">.+<\/div>$/);
		}
		expect(composition.section[1]).toEqual({
			title: "História da doença atual",
			code: {
				coding: [
					{
						system: "http://loinc.org",
						code: "10164-2",
						display: "History of Present illness Narrative",
					},
				],
			},
			text: {
				status: "additional",
				div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Dor frontal &lt;pulsátil&gt; &amp; piora à tarde.</p><p>Sem febre.</p></div>',
			},
		});
	});

	it("labels AI-drafted notes and names the drafting device in Provenance", () => {
		expect(composition.meta.security).toEqual([
			{
				system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue",
				code: "AIAST",
				display: "Artificial Intelligence asserted",
			},
		]);
		const device = only(bundle, "Device");
		expect(device.type.text).toBe("AI documentation assistant");
		const provenance = only(bundle, "Provenance");
		expect(provenance.target).toEqual([{ reference: `urn:uuid:${composition.id}` }]);
		expect(provenance.agent.map((a: Json) => [a.type.coding[0].code, a.who.reference])).toEqual([
			["author", `urn:uuid:${only(bundle, "Practitioner").id}`],
			["assembler", `urn:uuid:${device.id}`],
		]);
		expect(provenance.entity).toEqual([
			{
				role: "derivation",
				what: { reference: `urn:uuid:${only(bundle, "DocumentReference").id}` },
			},
		]);
	});

	it("carries the transcript as a preliminary UTF-8 DocumentReference", () => {
		const doc = only(bundle, "DocumentReference");
		expect(doc.docStatus).toBe("preliminary");
		const attachment = doc.content[0].attachment;
		expect(attachment.contentType).toBe("text/plain; charset=utf-8");
		expect(Buffer.from(attachment.data, "base64").toString("utf8")).toBe(
			makeConsultation().transcript,
		);
		expect(doc.context.encounter[0].reference).toBe(`urn:uuid:${only(bundle, "Encounter").id}`);
	});

	it("classes bot-captured consultations as virtual and live ones as in progress", () => {
		const encounters = resources(
			bundleOf(
				makeExport({
					consultations: [
						makeConsultation(),
						makeConsultation({ id: 11, source: "bot", status: "live" }),
					],
				}),
			),
			"Encounter",
		);
		expect(encounters.map((e) => [e.class.code, e.status])).toEqual([
			["AMB", "finished"],
			["VR", "in-progress"],
		]);
		expect(encounters[0].period).toEqual({ start: "2026-11-05T14:00:00.000Z" });
	});

	it("shares one Device per engine and labels rule-based drafts as non-AI", () => {
		const b = bundleOf(
			makeExport({
				consultations: [
					makeConsultation({ engine: "heuristic" }),
					makeConsultation({ id: 11, engine: "heuristic", transcript: "  " }),
				],
			}),
		);
		expect(resources(b, "Device")).toHaveLength(1);
		expect(only(b, "Device").type.text).toBe("Rule-based documentation assistant");
		expect(only(b, "Composition").meta).toBeUndefined();
		expect(resources(b, "DocumentReference")).toHaveLength(1);
		expect(resources(b, "Provenance")[1].entity).toBeUndefined();
	});

	it("omits Provenance, transcript and sections when there is nothing to attribute", () => {
		const b = bundleOf(
			makeExport({
				consultations: [makeConsultation({ engine: null, transcript: "", anamnesis: null })],
			}),
		);
		expect(resources(b, "Provenance")).toEqual([]);
		expect(resources(b, "Device")).toEqual([]);
		expect(resources(b, "DocumentReference")).toEqual([]);
		expect(only(b, "Composition").section).toBeUndefined();
		expect(validateFhir(b)).toBe(true);
	});

	it("skips blank sections and notes without the prior-visit summary", () => {
		const { historico: _omit, ...withoutHistory } = makeConsultation().anamnesis!;
		const c = only(
			bundleOf(
				makeExport({
					consultations: [
						makeConsultation({
							anamnesis: {
								...withoutHistory,
								exame_fisico: { ...withoutHistory.exame_fisico, content: " " },
							},
						}),
					],
				}),
			),
			"Composition",
		);
		const codes = c.section.map((s: Json) => s.code.coding[0].code);
		expect(codes).not.toContain("29545-1");
		expect(codes).not.toContain("46240-8");
		expect(codes).toHaveLength(7);
	});
});

describe("helpers", () => {
	it("encodes large UTF-8 text in chunks", () => {
		const text = "ção ".repeat(20_000);
		expect(Buffer.from(base64Utf8(text), "base64").toString("utf8")).toBe(text);
	});

	it("escapes quotes and drops blank lines in narrative", () => {
		expect(narrative('a "b"\n\n  \nc').div).toBe(
			'<div xmlns="http://www.w3.org/1999/xhtml"><p>a &quot;b&quot;</p><p>c</p></div>',
		);
	});

	it("records the practitioner without email when none is known", () => {
		const b = bundleOf(makeExport({ practitioner: { id: "u2", name: "Dr. X", email: null } }));
		expect(only(b, "Practitioner")).toEqual({
			resourceType: "Practitioner",
			id: only(b, "Practitioner").id,
			name: [{ text: "Dr. X" }],
		});
		expect(FULL_PATIENT.cpf).toBe("52998224725");
	});
});
