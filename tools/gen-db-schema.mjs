#!/usr/bin/env bun
/**
 * Generates packages/db/src/schema.gen.ts — the aggregated drizzle
 * schema entry point. Plugin-owned table definitions live in
 * plugins/<pkg>/src/schema.ts (P-061); this script re-exports them so
 * `@ktb/db/schema` stays the single import path WITHOUT @ktb/db
 * depending on plugin packages (which would recreate the workspace
 * cycle the host-owned layout was built to avoid). The generated file
 * therefore reaches into plugin sources by RELATIVE path — it is a
 * source file inside packages/db, not a package.json dependency edge.
 *
 * A plugin schema module (plugins/<pkg>/src/schema.ts) is included only
 * when it actually declares tables (sqliteTable/tenantTable/pgTable
 * call) — re-export shims and non-table schema modules are skipped.
 * Packages are NOT
 * scanned: packages/tenant and packages/anamnesis have schema.ts
 * modules that are helpers/contracts, not table definitions, and the
 * remaining host-owned tables (auth, plugin_state) live in
 * packages/db/src as hand-written slices.
 *
 * Run after adding/moving a plugin schema module:
 *
 *   bun run gen:db-schema
 *
 * Generated files are never hand-edited. CI verifies they are in sync
 * (ci:db-schema task).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pluginsDir = join(root, "plugins");
const outPath = join(root, "packages/db/src/schema.gen.ts");

// Matches a table declaration call: sqliteTable("name", ...),
// tenantTable("name", ...), pgTable("name", ...). Whitespace/newlines
// between the paren and the name are allowed.
const TABLE_DECL_RE = /\b(?:sqliteTable|tenantTable|pgTable)\s*\(\s*["'`]/;

const owners = readdirSync(pluginsDir, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name)
	.sort()
	.filter((name) => {
		const file = join(pluginsDir, name, "src/schema.ts");
		try {
			return TABLE_DECL_RE.test(readFileSync(file, "utf8"));
		} catch {
			return false;
		}
	});

const lines = [
	"// GENERATED FILE — do not edit.",
	"// Regenerate with `bun run gen:db-schema` (tools/gen-db-schema.mjs).",
	"// Aggregates plugin-owned drizzle table definitions for",
	"// `@ktb/db/schema` and drizzle-kit (drizzle.config.ts points here).",
	"// Relative paths are deliberate: @ktb/db must not depend on plugin",
	"// packages — see tools/gen-db-schema.mjs.",
	...owners.map((name) => `export * from "../../../plugins/${name}/src/schema.ts";`),
	"",
];

writeFileSync(outPath, lines.join("\n"));
console.log(
	`gen-db-schema: wrote ${outPath} (${owners.length} plugin schema module(s): ${owners.join(", ") || "none"})`,
);
