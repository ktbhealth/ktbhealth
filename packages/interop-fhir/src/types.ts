/**
 * The slice of FHIR R4 (4.0.1) this adapter emits — just enough typing
 * to keep the mapping honest without a full FHIR model dependency.
 */

export interface Coding {
	readonly system: string;
	readonly code: string;
	readonly display?: string;
}

export interface CodeableConcept {
	readonly coding?: readonly Coding[];
	readonly text?: string;
}

export interface Reference {
	readonly reference: string;
	readonly display?: string;
}

export interface Extension {
	readonly url: string;
	readonly valueCodeableConcept?: CodeableConcept;
	readonly valueString?: string;
	readonly extension?: readonly Extension[];
}

export interface Identifier {
	readonly use?: "usual" | "official" | "temp" | "secondary" | "old";
	readonly type?: CodeableConcept;
	readonly system?: string;
	readonly value: string;
}

export interface HumanName {
	readonly use?: "usual" | "official" | "temp" | "nickname" | "anonymous" | "old" | "maiden";
	readonly text: string;
}

interface ContactPoint {
	readonly system: "phone" | "email";
	readonly value: string;
}

interface Address {
	readonly use?: "home" | "work" | "temp" | "old" | "billing";
	readonly line?: readonly string[];
	readonly district?: string;
	readonly city?: string;
	readonly state?: string;
	readonly postalCode?: string;
	readonly country?: string;
}

export interface Narrative {
	readonly status: "generated" | "extensions" | "additional" | "empty";
	/** XHTML fragment rooted at `<div xmlns="http://www.w3.org/1999/xhtml">`. */
	readonly div: string;
}

interface Meta {
	readonly profile?: readonly string[];
}

export interface Patient {
	readonly resourceType: "Patient";
	readonly id: string;
	readonly meta?: Meta;
	readonly extension?: readonly Extension[];
	readonly identifier?: readonly Identifier[];
	readonly active: boolean;
	readonly name: readonly HumanName[];
	readonly telecom?: readonly ContactPoint[];
	readonly gender?: string;
	readonly birthDate?: string;
	readonly address?: readonly Address[];
	readonly maritalStatus?: CodeableConcept;
	readonly contact?: ReadonlyArray<{
		readonly relationship?: readonly CodeableConcept[];
		readonly name?: { readonly text: string };
		readonly telecom?: readonly ContactPoint[];
	}>;
	readonly communication?: ReadonlyArray<{
		readonly language: CodeableConcept;
		readonly preferred?: boolean;
	}>;
}

/** Any resource the bundle carries (each mapper owns its exact shape). */
export interface Resource {
	readonly resourceType: string;
	readonly id: string;
}

export interface Bundle {
	readonly resourceType: "Bundle";
	readonly id: string;
	readonly type: "collection" | "document";
	readonly timestamp: string;
	readonly entry: ReadonlyArray<{ readonly fullUrl: string; readonly resource: Resource }>;
}
