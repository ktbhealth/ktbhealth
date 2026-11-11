import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Runtime plugin state (P-058): host/platform-owned, NOT a plugin table —
 * the plugin manager itself is a plugin, so the state it administers
 * cannot live inside one. One row per toggled/configured plugin; the
 * ABSENCE of a row means "enabled with default config" (opt-out default,
 * preserving pre-P-058 behavior). `config` holds the JSON-merged value of
 * the plugin's config contract (`meta.config` JSON document validated
 * against `configSchema`); NULL means "schema defaults".
 * Per-tenant scoping lands with P-053 — the table is deliberately
 * deployment-global for now.
 *
 * Host-owned by @ktb/db (not a plugin slice): @ktb/platform's
 * PluginStates service writes here, so defining it in the platform
 * plugin would create a @ktb/db ↔ @ktb/platform workspace cycle.
 */
export const pluginState = sqliteTable("plugin_state", {
	pluginId: text("plugin_id").primaryKey(),
	enabled: integer({ mode: "boolean" }).notNull().default(true),
	config: text("config"),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
