import { Schema } from "effect";
import * as Data from "effect/Data";

/**
 * registry.ts — the eval contribution registry (P-070).
 *
 * Suites resolve their stage / metric / gate / capability references
 * through this small typed registry: plugins register
 * `{kind, id, version}` entries (declared on their manifests'
 * `contributions` channel — see kinds.ts) and the runner looks them up
 * by id. Ids are unique per kind —
 * a duplicate registration or an unknown lookup is a typed error, never
 * a silent override.
 *
 * Entries are DATA plus an optional implementation payload carried in
 * `meta`/`impl`-agnostic form — this module stays generic; what a stage
 * or gate DOES is the contributor's business.
 *
 * Contributors (P-074 phase 3): capability plugins under plugins/* are
 * data-only registrars — each declares a `contributions` array on its
 * plugin manifest (P-070). They cannot
 * host adapter code themselves (plugins/* is inside the arch-policy
 * PORT_GLOBS: no node:*, provider literals, or adapter imports), so
 * `meta.adapters` maps adapter keys to the exempt-edge packages
 * (@ktb/eval-adapter-stub/-local/-cloud) that implement the port named
 * by `meta.port`. Consumers compose by collecting the manifests'
 * `contributions` entries (kind descriptors in ./kinds.ts) and calling
 * `register` per entry — there is no global singleton.
 */

/**
 * The eval contribution kinds (P-070): namespaced `eval.*` ids so they
 * can share the generalized plugin `contributions` channel without
 * colliding with other domains' kinds. Each id is also a registered
 * `ContributionKindDescriptor` (see ./kinds.ts) whose slot is
 * "contributions" — eval plugins declare these entries on their
 * manifests and consumers (apps/eval) collect them from the plugin
 * graph.
 */
export const ContributionKind = Schema.Literals([
	"eval.stage",
	"eval.metric",
	"eval.gate",
	"eval.gatepreset",
	"eval.condition",
	"eval.capability",
]);
export type ContributionKind = typeof ContributionKind.Type;

/** A registered contribution — the unit suites reference by id. */
export const Contribution = Schema.Struct({
	kind: ContributionKind,
	id: Schema.String,
	version: Schema.String,
	/** Free-form JSON metadata (provided capabilities, deps, config
	 * hints). Kept JSON-only so contributions stay serializable. */
	meta: Schema.optionalKey(Schema.JsonObject),
});
export type Contribution = typeof Contribution.Type;

/**
 * Outcome of a contribution-declared config validation (P-078).
 * `ok` carries the decoded config (schema defaults applied);
 * `error` is a human-readable reason surfaced by `eval list` /
 * command resolution.
 */
export type ConfigValidation =
	| { readonly ok: true; readonly config: unknown }
	| { readonly ok: false; readonly error: string };

/**
 * A contribution's config validator (P-078) — CODE owned by the
 * contributor. effect/Schema is not JSON-serializable, so the config
 * shape cannot live in `meta`; instead the contributor registers a
 * function beside its contribution and manifests stay pure data.
 * `config` is the manifest entry's `config` object — legacy gate
 * `params` are normalized to it before validation — or `undefined`
 * when the entry declares none (validators treat that as "defaults"
 * and may still reject when config is required).
 */
export type ConfigValidator = (config: unknown) => ConfigValidation;

/**
 * A `Contribution` plus its optional runtime config validator. The
 * validator cannot be a Schema field (functions are not data) nor
 * `meta` (JSON-only), so it rides beside the data on the same
 * object: plugin manifests carry it through `toEvalContribution`
 * (kinds.ts) and domain packs declare it inline on their plain
 * contribution arrays. eval-core never calls it — apps/eval resolve
 * does, keeping this package domain-blind.
 */
export interface ContributionWithConfig extends Contribution {
	readonly validateConfig?: ConfigValidator;
}

/** Same kind+id registered twice — ids must be unique per kind. */
export class DuplicateContributionError extends Data.TaggedError("DuplicateContributionError")<{
	readonly kind: ContributionKind;
	readonly id: string;
	readonly version: string;
}> {}

/** Lookup for an id that was never registered. */
export class UnknownContributionError extends Data.TaggedError("UnknownContributionError")<{
	readonly kind: ContributionKind;
	readonly id: string;
}> {}

const keyOf = (kind: ContributionKind, id: string): string => `${kind}:${id}`;

/** In-memory contribution registry. Plain synchronous API — callers
 * compose it inside their own Effect services; typed errors are thrown
 * (TaggedError), so `Effect.try`/`Effect.catch` can lift them. */
export class ContributionRegistry {
	private readonly entries = new Map<string, ContributionWithConfig>();

	/** Register a contribution. Throws `DuplicateContributionError`
	 * when the same kind+id is already registered. `validateConfig`
	 * (P-078) rides along untouched — it is a runtime function, not
	 * registry data. */
	register(contribution: ContributionWithConfig): void {
		const key = keyOf(contribution.kind, contribution.id);
		if (this.entries.has(key)) {
			throw new DuplicateContributionError({
				kind: contribution.kind,
				id: contribution.id,
				version: contribution.version,
			});
		}
		this.entries.set(key, contribution);
	}

	/** Look up a contribution by kind+id. Throws
	 * `UnknownContributionError` when absent. The returned type keeps
	 * `validateConfig` visible (P-078). */
	get(kind: ContributionKind, id: string): ContributionWithConfig {
		const entry = this.entries.get(keyOf(kind, id));
		if (entry === undefined) {
			throw new UnknownContributionError({ kind, id });
		}
		return entry;
	}

	/** The contribution's declared config validator (P-078), or
	 * `undefined` when it declares none — callers treat "config on a
	 * validator-less contribution" as unverifiable, never silently
	 * accepted. */
	configValidator(kind: ContributionKind, id: string): ConfigValidator | undefined {
		return this.entries.get(keyOf(kind, id))?.validateConfig;
	}

	has(kind: ContributionKind, id: string): boolean {
		return this.entries.has(keyOf(kind, id));
	}

	/** All registered contributions, optionally filtered by kind, in
	 * registration order. */
	list(kind?: ContributionKind): readonly ContributionWithConfig[] {
		const all = [...this.entries.values()];
		return kind === undefined ? all : all.filter((c) => c.kind === kind);
	}
}
