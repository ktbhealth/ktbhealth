/**
 * openEHR (RM 1.1.0) adapter for the interop export port: the patient's
 * record as an openEHR EXTRACT (Extract IM) in canonical JSON. One
 * EXTRACT_ENTITY_CHAPTER for the patient holds, as versioned objects:
 *
 * - the demographic PERSON (+ related PERSONs) — demographics stay
 *   separate from the EHR, as the RM intends;
 * - the EHR_STATUS whose PARTY_SELF points at that PERSON;
 * - one encounter COMPOSITION per consultation, committed with lifecycle
 *   `incomplete` (553): drafted from the transcript, not signed off.
 */
import type { ClinicalRecordExport, ConsultationRecord, RecordExporter } from "@ktb/interop";

import { toComposition } from "./composition.ts";
import { relatedPersons, toPerson, toRelatedPerson } from "./person.ts";
import { type Json, dvDateTime, dvOpenehr, dvText, hierId, partyRef, root } from "./rm.ts";

export { DEVIATIONS } from "./person.ts";
export { ENCOUNTER, SECTIONS } from "./composition.ts";

/** Creating system, as recorded in audits and version ids. */
export const SYSTEM_ID = "ktbhealth";
export const EHR_STATUS_ARCHETYPE = "openEHR-EHR-EHR_STATUS.generic.v1";

const objectRef = (id: string, namespace: string, type: string): Json => ({
	_type: "OBJECT_REF",
	id: hierId(id),
	namespace,
	type,
});

interface VersionInput {
	readonly kind: "X_VERSIONED_PARTY" | "X_VERSIONED_EHR_STATUS" | "X_VERSIONED_COMPOSITION";
	readonly objectId: string;
	readonly owner: Json;
	readonly data: Json;
	readonly at: Date;
	readonly committer: string;
	readonly complete: boolean;
	readonly description?: string;
	readonly primary?: boolean;
}

/** A single-version versioned object wrapped as extract content. */
function contentItem(v: VersionInput, contribution: string): Json {
	return {
		_type: "OPENEHR_CONTENT_ITEM",
		archetype_node_id: "at0000",
		name: dvText(String(v.data._type)),
		is_primary: v.primary ?? false,
		item: {
			_type: v.kind,
			uid: hierId(v.objectId),
			owner_id: v.owner,
			time_created: dvDateTime(v.at),
			total_version_count: 1,
			extract_version_count: 1,
			versions: [
				{
					_type: "ORIGINAL_VERSION",
					uid: { _type: "OBJECT_VERSION_ID", value: `${v.objectId}::${SYSTEM_ID}::1` },
					contribution: objectRef(contribution, "local", "CONTRIBUTION"),
					commit_audit: {
						_type: "AUDIT_DETAILS",
						system_id: SYSTEM_ID,
						time_committed: dvDateTime(v.at),
						change_type: dvOpenehr("creation", "249"),
						committer: { _type: "PARTY_IDENTIFIED", name: v.committer },
						...(v.description ? { description: dvText(v.description) } : {}),
					},
					lifecycle_state: v.complete
						? dvOpenehr("complete", "532")
						: dvOpenehr("incomplete", "553"),
					data: v.data,
				},
			],
		},
	};
}

const draftNote = (c: ConsultationRecord) =>
	c.engine
		? `Drafted by ${c.engine} from the consultation transcript; physician-editable, not signed off.`
		: "Physician-editable consultation record; not signed off.";

export function toOpenEhrExtract(
	input: ClinicalRecordExport,
	uuid: () => string = () => crypto.randomUUID(),
): Json {
	const { patient, practitioner, exportedAt } = input;
	const personId = uuid();
	const ehrId = uuid();
	const contribution = uuid();
	const related = relatedPersons(patient, uuid);
	const ehrOwner = objectRef(ehrId, "local", "EHR");
	const partyOwner = partyRef(personId);
	const committer = practitioner.name;

	const items: Json[] = [
		contentItem(
			{
				kind: "X_VERSIONED_PARTY",
				objectId: personId,
				owner: partyOwner,
				data: toPerson(patient, personId, related, uuid),
				at: patient.updatedAt ?? patient.createdAt,
				committer,
				complete: true,
				primary: true,
			},
			contribution,
		),
		...related.map((r) =>
			contentItem(
				{
					kind: "X_VERSIONED_PARTY",
					objectId: r.uid,
					owner: partyRef(r.uid),
					data: toRelatedPerson(r),
					at: patient.updatedAt ?? patient.createdAt,
					committer,
					complete: true,
				},
				contribution,
			),
		),
		contentItem(
			{
				kind: "X_VERSIONED_EHR_STATUS",
				objectId: uuid(),
				owner: ehrOwner,
				data: {
					_type: "EHR_STATUS",
					...root(EHR_STATUS_ARCHETYPE),
					name: dvText("EHR Status"),
					subject: { _type: "PARTY_SELF", external_ref: partyRef(personId) },
					is_queryable: true,
					is_modifiable: true,
				},
				at: patient.createdAt,
				committer,
				complete: true,
			},
			contribution,
		),
		...input.consultations.map((c) => {
			const objectId = uuid();
			return contentItem(
				{
					kind: "X_VERSIONED_COMPOSITION",
					objectId,
					owner: ehrOwner,
					data: toComposition(c, practitioner, `${objectId}::${SYSTEM_ID}::1`),
					at: c.createdAt,
					committer,
					complete: false,
					description: draftNote(c),
				},
				contribution,
			);
		}),
	];

	return {
		_type: "EXTRACT",
		archetype_node_id: "at0000",
		name: dvText("KTB Health patient record export"),
		uid: hierId(uuid()),
		time_created: dvDateTime(exportedAt),
		system_id: hierId(SYSTEM_ID),
		sequence_nr: 1,
		chapters: [
			{
				_type: "EXTRACT_ENTITY_CHAPTER",
				archetype_node_id: "at0000",
				name: dvText(patient.socialName ?? patient.name),
				extract_id_key: ehrId,
				items,
			},
		],
	};
}

export const openEhrExporter: RecordExporter = {
	format: "openehr",
	mediaType: "application/json",
	fileSuffix: "openehr.json",
	render: (input, options) => JSON.stringify(toOpenEhrExtract(input, options?.uuid), null, 2),
};
