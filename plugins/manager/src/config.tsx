import { Schema } from "effect";

import type { PluginConfigSchema } from "@ktb/kernel";

/**
 * Config contract for `manager.panel` (P-058) — dogfooded by the
 * /platform/plugins console itself.
 *
 * NOTE the `.tsx` extension: `src/client.ts` may only value-import
 * relative `.tsx` modules (ktb-arch/client-contract), so the shared
 * isomorphic manifest data lives here even though it contains no JSX.
 *
 * `managerConfigSchema` is the effect/Schema SOURCE OF TRUTH: the
 * server manifest (`./index.ts`) exposes it as `configSchema` so
 * PluginStates can decode incoming/stored JSON against it at runtime.
 * `managerConfig` is its serializable projection — the JSON Schema
 * document (draft 2020-12) stored on `meta.config` — shared verbatim by
 * BOTH manifests so the client registry renders the generated form
 * without pulling the Schema (or any server-only dep) into the bundle.
 * Keep the two in sync by construction: never hand-edit the document,
 * change the Schema and re-derive.
 */
export const managerConfigSchema = Schema.Struct({
	cascadeConfirm: Schema.optionalKey(Schema.Boolean).annotate({
		title: "Confirm cascading disables",
		default: true,
	}),
});

export const managerConfig: PluginConfigSchema = {
	schema: Schema.toJsonSchemaDocument(managerConfigSchema),
};
