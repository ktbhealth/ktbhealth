/**
 * Builders for openEHR RM 1.1.0 values in canonical JSON (ITS-JSON):
 * every object carries its RM class in `_type`, names are DV_TEXT /
 * DV_CODED_TEXT objects, and archetype roots carry `archetype_details`.
 */

const RM_VERSION = "1.1.0";

export type Json = { readonly [key: string]: unknown };

export const codePhrase = (terminology: string, code: string): Json => ({
	_type: "CODE_PHRASE",
	terminology_id: { _type: "TERMINOLOGY_ID", value: terminology },
	code_string: code,
});

export const dvText = (value: string): Json => ({ _type: "DV_TEXT", value });

export const dvCoded = (value: string, terminology: string, code: string): Json => ({
	_type: "DV_CODED_TEXT",
	value,
	defining_code: codePhrase(terminology, code),
});

/** Archetype-local code (`local::atNNNN`). */
export const dvLocal = (value: string, code: string): Json => dvCoded(value, "local", code);

/** openEHR terminology code (e.g. 433 "event"). */
export const dvOpenehr = (value: string, code: string): Json => dvCoded(value, "openehr", code);

export const dvDate = (value: string): Json => ({ _type: "DV_DATE", value });
export const dvDateTime = (value: Date): Json => ({
	_type: "DV_DATE_TIME",
	value: value.toISOString(),
});
export const dvBoolean = (value: boolean): Json => ({ _type: "DV_BOOLEAN", value });

export const hierId = (value: string): Json => ({ _type: "HIER_OBJECT_ID", value });

const archetyped = (archetypeId: string): Json => ({
	_type: "ARCHETYPED",
	archetype_id: { _type: "ARCHETYPE_ID", value: archetypeId },
	rm_version: RM_VERSION,
});

/** Archetype root header: node id is the archetype id, plus archetype_details. */
export const root = (archetypeId: string): Json => ({
	archetype_node_id: archetypeId,
	archetype_details: archetyped(archetypeId),
});

export const element = (nodeId: string, name: string, value: Json): Json => ({
	_type: "ELEMENT",
	archetype_node_id: nodeId,
	name: dvText(name),
	value,
});

export const cluster = (nodeId: string, name: string, items: readonly Json[]): Json => ({
	_type: "CLUSTER",
	archetype_node_id: nodeId,
	name: dvText(name),
	items,
});

export const itemTree = (nodeId: string, name: string, items: readonly Json[]): Json => ({
	_type: "ITEM_TREE",
	archetype_node_id: nodeId,
	name: dvText(name),
	items,
});

/** Reference to a party in the demographic service. */
export const partyRef = (uuid: string, type = "PERSON"): Json => ({
	_type: "PARTY_REF",
	id: hierId(uuid),
	namespace: "demographic",
	type,
});
