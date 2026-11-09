/**
 * FHIR R4 (4.0.1) adapter for the interop export port: the patient's
 * record as a `collection` Bundle — a package for distribution with no
 * processing obligations — holding the Patient, the documenting
 * Practitioner, the drafting Device(s) and, per consultation, Encounter,
 * Composition, transcript DocumentReference and Provenance. Entries are
 * addressed by `urn:uuid:` fullUrls and reference each other by them.
 */
import type { ClinicalRecordExport, PractitionerRecord, RecordExporter } from "@ktb/interop";

import { consultationResources, isAiEngine } from "./consultation.ts";
import { toPatient } from "./patient.ts";
import type { Bundle, Reference, Resource } from "./types.ts";

export { BR_CORE_PATIENT, meetsBrCore } from "./patient.ts";
export { NOTE_TYPE, SECTIONS } from "./consultation.ts";
export type { Bundle } from "./types.ts";

const ref = (id: string, display?: string): Reference => ({
	reference: `urn:uuid:${id}`,
	...(display ? { display } : {}),
});

/** No council registration (CRM) is recorded yet, so BR Core Practitioner is not claimed. */
const toPractitioner = (p: PractitionerRecord, id: string): Resource & Record<string, unknown> => ({
	resourceType: "Practitioner",
	id,
	name: [{ text: p.name }],
	...(p.email ? { telecom: [{ system: "email", value: p.email }] } : {}),
});

/** The software that drafted notes from the transcript. */
const toDevice = (engine: string, id: string): Resource & Record<string, unknown> => ({
	resourceType: "Device",
	id,
	deviceName: [{ name: `KTB Health anamnesis extractor (${engine})`, type: "user-friendly-name" }],
	type: {
		text: isAiEngine(engine) ? "AI documentation assistant" : "Rule-based documentation assistant",
	},
});

export function toFhirBundle(
	input: ClinicalRecordExport,
	uuid: () => string = () => crypto.randomUUID(),
): Bundle {
	const patientId = uuid();
	const practitionerId = uuid();
	const patient = ref(patientId, input.patient.socialName ?? input.patient.name);
	const practitioner = ref(practitionerId, input.practitioner.name);

	const devices = new Map<string, string>();
	const deviceFor = (engine: string | null): Reference | null => {
		if (!engine) return null;
		if (!devices.has(engine)) devices.set(engine, uuid());
		return ref(devices.get(engine) as string);
	};

	const notes = input.consultations.flatMap((c) =>
		consultationResources(c, {
			patient,
			practitioner,
			device: deviceFor(c.engine),
			ids: { encounter: uuid(), composition: uuid(), transcript: uuid(), provenance: uuid() },
		}),
	);

	const resources: Resource[] = [
		toPatient(input.patient, patientId),
		toPractitioner(input.practitioner, practitionerId),
		...[...devices].map(([engine, id]) => toDevice(engine, id)),
		...notes,
	];
	return {
		resourceType: "Bundle",
		id: uuid(),
		type: "collection",
		timestamp: input.exportedAt.toISOString(),
		entry: resources.map((resource) => ({ fullUrl: `urn:uuid:${resource.id}`, resource })),
	};
}

export const fhirR4Exporter: RecordExporter = {
	format: "fhir-r4",
	mediaType: "application/fhir+json",
	fileSuffix: "fhir-r4.json",
	render: (input, options) => JSON.stringify(toFhirBundle(input, options?.uuid), null, 2),
};
