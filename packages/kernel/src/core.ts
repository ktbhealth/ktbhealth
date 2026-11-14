import type { ComponentType } from "react";
import type * as JsonSchema from "effect/JsonSchema";
import type { JsonObject } from "effect/Schema";
import type * as Schema from "effect/Schema";

/**
 * Registry of plugin ids known at compile time. Each plugin entry module
 * contributes its ids via `declare module "@ktb/kernel"` augmentation;
 * `requiredDeps`/`optionalDeps` are typed against `keyof PluginRegistry`,
 * so a dep on an undeclared id fails typecheck at the plugin's own
 * declaration — as long as the dep's entry module is imported (directly
 * or transitively) so its augmentation is part of the program.
 * `orderPlugins` (@ktb/driver-framework) re-validates every dep at
 * runtime: that is the backstop for plugin modules reached through
 * import.meta.glob that the typechecker never loaded.
 */
export interface PluginRegistry {}

export type PluginId = Extract<keyof PluginRegistry, string>;

/** Declarative config contract on `PluginBase.meta.config` (P-058): a
 * JSON Schema document (draft 2020-12) — plain serializable JSON, safe
 * on BOTH the server and client registries. It is the projection of the
 * plugin's `configSchema` (effect/Schema) produced by
 * `Schema.toJsonSchemaDocument`: the host auto-generates a settings
 * form from it and external tooling can validate stored config JSON
 * against it directly. v1 covers flat scalar/enum properties only —
 * nested objects/arrays are a later step (`panel.settings` for bespoke
 * UIs). `default` keywords on properties fill missing values. */
export interface PluginConfigSchema {
	readonly schema: JsonSchema.Document<"draft-2020-12">;
}

/** Optional plugin metadata for the /platform/plugins manager (P-058):
 * display name/description/version, an icon (any component accepting
 * `className`, like lucide icons), and the config schema above. */
export interface PluginMeta {
	readonly name?: string;
	readonly description?: string;
	readonly version?: string;
	readonly icon?: ComponentType<{ readonly className?: string }>;
	readonly config?: PluginConfigSchema;
}

/**
 * One entry in a plugin's generic `contributions` array (P-070) — the
 * kind-agnostic channel for contribution kinds that have no dedicated
 * typed field on the Plugin union (domain kinds like `"eval.stage"`,
 * or kinds introduced after this contract froze). `kind` is the
 * registered kind id — see `ContributionKindDescriptor` in ./kinds.ts;
 * `meta` is JSON-only metadata, the same serializability contract as
 * `PluginConfigSchema`. Entries are data: what a kind MEANS is defined
 * by the kind's consumers, never by the kernel.
 */
export interface PluginContribution {
	readonly kind: string;
	readonly id: string;
	readonly version?: string;
	readonly meta?: JsonObject;
}

export interface PluginBase {
	readonly id: string;
	/** Display/config metadata consumed by the platform plugin manager. */
	readonly meta?: PluginMeta;
	/** Server-only: the effect/Schema that `meta.config.schema` (the
	 * JSON Schema document) was derived from. `PluginStates` decodes
	 * incoming/stored config JSON against it at runtime — this is the
	 * validation source of truth; the JSON document is the serializable
	 * interop form. NOT serializable, so client registries
	 * (`src/client.ts`) must omit it — `meta` stays the only channel
	 * that must match across the server/client parity boundary. */
	readonly configSchema?: Schema.ConstraintDecoder<unknown>;
	/** Hard dependency: the dep's services compose before this plugin's
	 * (topo order) and composition fails when the dep is absent. */
	readonly requiredDeps?: readonly PluginId[];
	/** Ordering hint only: the dep may be absent. A plugin must NOT
	 * require an optional dep's services in its layer — absence is legal,
	 * so a layer requirement on it would break composition. Layers are
	 * type-erased (`Layer.Any`), so this is a documented contract, not a
	 * statically enforced one. */
	readonly optionalDeps?: readonly PluginId[];
	/** System plugin (P-062): host infrastructure that can never be
	 * disabled — `PluginStates.isEnabled` short-circuits true and
	 * `setEnabled(…, false)` is rejected server-side, so a stale
	 * `plugin_state` row can never turn it off. Config writes stay
	 * allowed (config ≠ enablement). Must reach BOTH registries: the
	 * client mirror declares it too so the manager UI can render the
	 * locked state (parity is asserted by apps/web plugins.test.ts). */
	readonly system?: boolean;
	/** Generic contribution entries for kinds without a dedicated typed
	 * field (P-070). Each entry names a registered kind id; consumers
	 * opt in by collecting only the kinds they know (see
	 * `collectKindContributions` in ./kinds.ts). May accompany a typed
	 * contribution field — the generic channel is not bound by the
	 * one-dedicated-field rule. */
	readonly contributions?: readonly PluginContribution[];
}

type ContributionField =
	| "tables"
	| "services"
	| "routes"
	| "landing"
	| "chrome"
	| "panel"
	| "pages";

/** Marks every contribution field EXCEPT `K` as forbidden (`?: never`). */
export type ForbiddenContributions<K extends ContributionField> = {
	readonly [F in Exclude<ContributionField, K>]?: never;
};
