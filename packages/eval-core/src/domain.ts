import { Option, Schema } from "effect";
import type { Json } from "effect/Schema";
import * as Data from "effect/Data";

import {
	ContributionRef,
	refIdOf,
	SuiteGateEntry,
	type ContributionRef as ContributionRefType,
	type SuiteGateEntry as SuiteGateEntryType,
} from "./suite.ts";

/**
 * domain.ts — the domain-pack DEFINITION contract (P-079).
 *
 * A domain pack (`evals/<domain>/`) is mostly data: this module
 * describes WHICH registered contributions assemble the eval, which
 * locale/templates/persona-matrix/PHI categories it speaks, and which
 * params a suite manifest may override. It is deliberately generic —
 * eval-core stays domain-blind; the pack fills the sections.
 *
 * THE HONEST BOUNDARY: stage implementations, metric math, gate
 * evaluation, anonymization patterns and WER stay CODE — registered
 * `eval.*` contributions (registry.ts/kinds.ts). The definition only
 * NAMES them (by id, optionally with config) plus the pack-level
 * knobs. Nothing here is executable pipeline logic.
 *
 * PARAMETRIZATION: `params` is an open JSON record of domain-owned
 * knobs (dataset generator defaults, entity-category subsets,
 * cohort tags…). Suite manifests override the whole definition via
 * `domainParams` (suite.ts) — a partial DomainOverrides decoded by
 * `validateDomainOverrides` and merged by `mergeDomainDefinitions`.
 *
 * COMPOSABILITY: `extends` names a parent domain id. Resolution
 * (domainChain/resolveDomainDefinition) walks the chain and merges:
 * `provides` contribution lists UNION by id (child config wins on
 * conflict), named sections (locale/templates/personas/phi) are
 * replaced wholesale by the child's declaration, `params`
 * deep-merges with the child winning leaf conflicts.
 */

/** Persona-matrix dimensions — the axes a domain's dataset varies
 * over. Generic shape: packs map the literals to their own content
 * (consultation's are pt-BR regions; another domain ships its own). */
export const DomainMatrix = Schema.Struct({
	regions: Schema.Array(Schema.String),
	ageBands: Schema.Array(Schema.String),
	registers: Schema.Array(Schema.String),
	specialties: Schema.Array(Schema.String),
});
export type DomainMatrix = typeof DomainMatrix.Type;

/** Locale binding — `profile` is the domain's LocaleProfile id
 * (persisted as StageMetrics.normalization); `tag` is the locale
 * name template dirs and `--locale` are keyed by. */
export const DomainLocale = Schema.Struct({
	profile: Schema.String,
	tag: Schema.optionalKey(Schema.String),
});
export type DomainLocale = typeof DomainLocale.Type;

/** Template binding — `dir` is pack-relative (resolved against the
 * domain file's directory by apps/eval); `name` is the default
 * template basename (no `.eta`). */
export const DomainTemplates = Schema.Struct({
	dir: Schema.String,
	name: Schema.optionalKey(Schema.String),
});
export type DomainTemplates = typeof DomainTemplates.Type;

/** PHI policy declaration — the anonymize/audit categories the
 * domain's scrub layer covers (e.g. cpf/phone/email/date_of_birth).
 * The patterns themselves stay code in the pack's locale profile. */
export const DomainPhi = Schema.Struct({
	categories: Schema.Array(Schema.String),
});
export type DomainPhi = typeof DomainPhi.Type;

/** A contribution ref entry — bare id or `{id, config}` (same shape
 * as manifest metric refs). */
const ContributionList = Schema.Array(Schema.Union([Schema.String, ContributionRef]));

/** What the domain pack provides — contribution ids it declares as
 * its eval vocabulary. Stages/capabilities may be contributed by
 * capability plugins rather than the pack itself; the definition
 * still names the ids its suites compose. `gates` uses the manifest
 * gate-entry shape so presets (`{preset, overrides?}`) are expressible. */
export const DomainProvides = Schema.Struct({
	stages: Schema.optionalKey(ContributionList),
	metrics: Schema.optionalKey(ContributionList),
	gates: Schema.optionalKey(Schema.Array(SuiteGateEntry)),
	gatePresets: Schema.optionalKey(ContributionList),
	conditions: Schema.optionalKey(ContributionList),
	/** capability id → providing plugin id (same map suites declare
	 * in `caps`). */
	capabilities: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type DomainProvides = typeof DomainProvides.Type;

/** The domain-pack definition — pure data, validated at definition
 * time by `defineDomain`. `extends` is a domain id resolved by the
 * composition root (apps/eval) against discovered definitions. */
export const DomainDefinition = Schema.Struct({
	id: Schema.String,
	version: Schema.String,
	/** Parent domain id — data-level inheritance (see module header
	 * for merge semantics). */
	extends: Schema.optionalKey(Schema.String),
	provides: Schema.optionalKey(DomainProvides),
	locale: Schema.optionalKey(DomainLocale),
	templates: Schema.optionalKey(DomainTemplates),
	personas: Schema.optionalKey(DomainMatrix),
	phi: Schema.optionalKey(DomainPhi),
	/** Open domain-owned param bag — suite manifests override via
	 * `domainParams` (manifest) → `params` deep-merge. Keys are
	 * domain vocabulary (dataset generator defaults, entity-category
	 * subsets, cohort tags); eval-core does not interpret them. */
	params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});
export type DomainDefinition = typeof DomainDefinition.Type;

/** Suite-manifest `domainParams` shape — the overridable subset of a
 * domain definition. `provides`/`extends`/`id`/`version` are NOT
 * overridable: contributions stay code-registered and inheritance is
 * resolved before overrides apply. */
export const DomainOverrides = Schema.Struct({
	locale: Schema.optionalKey(DomainLocale),
	templates: Schema.optionalKey(DomainTemplates),
	personas: Schema.optionalKey(DomainMatrix),
	phi: Schema.optionalKey(DomainPhi),
	params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});
export type DomainOverrides = typeof DomainOverrides.Type;

const DEFINITION_KEYS = new Set([
	"id",
	"version",
	"extends",
	"provides",
	"locale",
	"templates",
	"personas",
	"phi",
	"params",
]);
const OVERRIDE_KEYS = new Set(["locale", "templates", "personas", "phi", "params"]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const unknownKeys = (input: Record<string, unknown>, allowed: ReadonlySet<string>): string[] =>
	Object.keys(input).filter((k) => !allowed.has(k));

/** Validate + decode a domain definition. Returns `null` on any
 * schema violation or unknown top-level key — a typo'd section name
 * must not silently drop the domain's vocabulary. */
export const validateDomain = (input: unknown): DomainDefinition | null => {
	if (!isRecord(input)) return null;
	if (unknownKeys(input, DEFINITION_KEYS).length > 0) return null;
	return Option.getOrNull(Schema.decodeUnknownOption(DomainDefinition)(input));
};

/** Validate + decode suite-manifest `domainParams` — same strictness:
 * unknown top-level keys are rejected so a typo cannot no-op. */
export const validateDomainOverrides = (input: unknown): DomainOverrides | null => {
	if (!isRecord(input)) return null;
	if (unknownKeys(input, OVERRIDE_KEYS).length > 0) return null;
	return Option.getOrNull(Schema.decodeUnknownOption(DomainOverrides)(input));
};

/** Define a domain pack definition — throws a Schema parse error on
 * invalid data (same contract as `defineSuite`). */
export const defineDomain = (input: unknown): DomainDefinition => {
	const checked = validateDomain(input);
	if (checked === null) {
		// Re-run the raw decode for the detailed SchemaError message.
		return Schema.decodeUnknownSync(DomainDefinition)(input);
	}
	return checked;
};

// ---------- merge semantics ----------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	isRecord(v) &&
	(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Deep-merge two JSON values: plain objects merge recursively,
 * everything else (arrays, scalars, null) is replaced by `over`.
 * `undefined` on either side passes the other through. */
export const mergeJson = (base: Json | undefined, over: Json | undefined): Json | undefined => {
	if (over === undefined) return base;
	if (base === undefined) return over;
	if (isPlainObject(base) && isPlainObject(over)) {
		const out: Record<string, Json> = { ...(base as Record<string, Json>) };
		for (const [k, v] of Object.entries(over)) {
			out[k] = mergeJson(out[k], v as Json) as Json;
		}
		return out;
	}
	return over;
};

/** Deep-merge two `params` records (undefined treated as absent). */
export const mergeDomainParams = (
	base: Readonly<Record<string, Json>> | undefined,
	over: Readonly<Record<string, Json>> | undefined,
): Record<string, Json> | undefined => {
	if (base === undefined) return over === undefined ? undefined : { ...over };
	if (over === undefined) return { ...base };
	return mergeJson(base as unknown as Json, over as unknown as Json) as Record<string, Json>;
};

const refKey = (entry: string | ContributionRefType): string => refIdOf(entry);

/** Union two contribution-ref lists by id — first-seen order is
 * kept, the child's entry wins on id conflict (its `config`
 * overrides the parent's). */
const mergeRefList = (
	parent: readonly (string | ContributionRefType)[] | undefined,
	child: readonly (string | ContributionRefType)[] | undefined,
): (string | ContributionRefType)[] | undefined => {
	if (parent === undefined) return child === undefined ? undefined : [...child];
	if (child === undefined) return [...parent];
	const out = new Map<string, string | ContributionRefType>();
	for (const e of parent) out.set(refKey(e), e);
	for (const e of child) out.set(refKey(e), e);
	return [...out.values()];
};

const gateKey = (g: SuiteGateEntryType): string =>
	g.id !== undefined ? `id:${g.id}` : `preset:${g.preset}`;

/** Union two gate-entry lists by target (`id:`/`preset:` key) —
 * child's entry wins on conflict. */
const mergeGateList = (
	parent: readonly SuiteGateEntryType[] | undefined,
	child: readonly SuiteGateEntryType[] | undefined,
): SuiteGateEntryType[] | undefined => {
	if (parent === undefined) return child === undefined ? undefined : [...child];
	if (child === undefined) return [...parent];
	const out = new Map<string, SuiteGateEntryType>();
	for (const g of parent) out.set(gateKey(g), g);
	for (const g of child) out.set(gateKey(g), g);
	return [...out.values()];
};

const pick = <T>(child: T | undefined, parent: T | undefined): T | undefined =>
	child !== undefined ? child : parent;

const mergeProvides = (
	parent: DomainProvides | undefined,
	child: DomainProvides | undefined,
): DomainProvides | undefined => {
	if (parent === undefined) return child === undefined ? undefined : { ...child };
	if (child === undefined) return { ...parent };
	const stages = mergeRefList(parent.stages, child.stages);
	const metrics = mergeRefList(parent.metrics, child.metrics);
	const gates = mergeGateList(parent.gates, child.gates);
	const gatePresets = mergeRefList(parent.gatePresets, child.gatePresets);
	const conditions = mergeRefList(parent.conditions, child.conditions);
	const capabilities =
		parent.capabilities === undefined && child.capabilities === undefined
			? undefined
			: { ...parent.capabilities, ...child.capabilities };
	const out: Record<string, unknown> = {};
	if (stages !== undefined) out.stages = stages;
	if (metrics !== undefined) out.metrics = metrics;
	if (gates !== undefined) out.gates = gates;
	if (gatePresets !== undefined) out.gatePresets = gatePresets;
	if (conditions !== undefined) out.conditions = conditions;
	if (capabilities !== undefined) out.capabilities = capabilities;
	return out as DomainProvides;
};

/**
 * Merge `child` over `parent` — the `extends` semantics:
 *
 * - `id`/`version`: the child's own (an extending domain is a new
 *   domain, not a copy).
 * - `extends`: the child's declaration wins (chain resolution has
 *   already flattened ancestors when this runs stepwise).
 * - `provides`: per-kind UNION by ref id / gate key; on conflict the
 *   child's entry (incl. its `config`) wins.
 * - `locale`/`templates`/`personas`/`phi`: the child's section
 *   REPLACES the parent's wholesale when declared — sections are
 *   coherent units, partial section merges would produce
 *   half-parent/half-child vocabularies.
 * - `params`: deep-merged JSON — child wins leaf conflicts, nested
 *   records merge recursively, arrays/scalars replace.
 */
export const mergeDomainDefinitions = (
	parent: DomainDefinition,
	child: DomainDefinition,
): DomainDefinition => {
	const provides = mergeProvides(parent.provides, child.provides);
	const params = mergeDomainParams(parent.params, child.params);
	const out: Record<string, unknown> = {
		id: child.id,
		version: child.version,
	};
	const extends_ = pick(child.extends, parent.extends);
	if (extends_ !== undefined) out.extends = extends_;
	if (provides !== undefined) out.provides = provides;
	const locale = pick(child.locale, parent.locale);
	if (locale !== undefined) out.locale = locale;
	const templates = pick(child.templates, parent.templates);
	if (templates !== undefined) out.templates = templates;
	const personas = pick(child.personas, parent.personas);
	if (personas !== undefined) out.personas = personas;
	const phi = pick(child.phi, parent.phi);
	if (phi !== undefined) out.phi = phi;
	if (params !== undefined) out.params = params;
	return out as DomainDefinition;
};

/** Typed failure for `domainChain`/`resolveDomainDefinition` —
 * unknown id, unknown `extends` target, or an `extends` cycle. */
export class DomainResolutionError extends Data.TaggedError("DomainResolutionError")<{
	readonly message: string;
}> {}

/**
 * Resolve an `extends` chain to the ordered definition list —
 * LEAF FIRST (`result[0]` is the requested domain, the last entry is
 * the chain root). Throws DomainResolutionError on an unknown id,
 * unknown `extends` target, or cycle. Merging is the caller's job
 * (fold `mergeDomainDefinitions` root→leaf, or use
 * `resolveDomainDefinition`).
 */
export const domainChain = (
	definitions: readonly DomainDefinition[],
	id: string,
): readonly DomainDefinition[] => {
	const byId = new Map(definitions.map((d) => [d.id, d]));
	const chain: DomainDefinition[] = [];
	const seen = new Set<string>();
	let cur = byId.get(id);
	if (cur === undefined) {
		throw new DomainResolutionError({
			message: `unknown domain "${id}" — known: ${[...byId.keys()].join(", ") || "(none)"}`,
		});
	}
	for (;;) {
		if (seen.has(cur.id)) {
			throw new DomainResolutionError({ message: `domain "extends" cycle at "${cur.id}"` });
		}
		seen.add(cur.id);
		chain.push(cur);
		if (cur.extends === undefined) return chain;
		const parent = byId.get(cur.extends);
		if (parent === undefined) {
			throw new DomainResolutionError({
				message: `domain "${cur.id}" extends unknown domain "${cur.extends}"`,
			});
		}
		cur = parent;
	}
};

/** Fully-resolved domain definition — the chain merged root→leaf
 * (leaf params/sections win). Equivalent to folding
 * `mergeDomainDefinitions` over `domainChain` reversed. */
export const resolveDomainDefinition = (
	definitions: readonly DomainDefinition[],
	id: string,
): DomainDefinition => {
	const chain = domainChain(definitions, id);
	let acc = chain[chain.length - 1]!;
	for (let i = chain.length - 2; i >= 0; i--) {
		acc = mergeDomainDefinitions(acc, chain[i]!);
	}
	return acc;
};
