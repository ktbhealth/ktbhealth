#!/usr/bin/env bun
/**
 * generate-erd — build a throwaway SQLite database from the Drizzle
 * migrations and render database docs (SVG ER diagrams, per-table
 * reference pages, Mermaid ER source) into the sibling `docs` repo.
 *
 * Pipeline: drizzle/*.sql → better-sqlite3 → tbls doc / tbls out.
 * Requires `tbls` on PATH (https://github.com/k1LoW/tbls) or $TBLS_BIN.
 *
 * In addition to the full-schema diagram, per-domain ER diagrams
 * (schema-<domain>.svg / schema-<domain>.mmd) are generated for each
 * entry in DOMAINS below — a table→domain map kept in sync with the
 * plugin/package ownership of the tables.
 *
 * Usage: bun packages/db/scripts/generate-erd.mjs [--out <dir>] [--check]
 *        --out overrides the docs content root (default: both locales).
 *        --check regenerates into a temp dir and diffs against the
 *        committed docs output without writing anything; exits 1 on
 *        any difference (used by CI).
 */
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_DIR = join(PKG_DIR, "drizzle");
const DOCS_REPO = resolve(PKG_DIR, "../../../docs");
const LOCALES = ["en", "pt-BR"];
const GENERATED_BY = "bun run db:erd (product/packages/db/scripts/generate-erd.mjs)";

/**
 * Domain grouping for the per-domain ER diagrams. Every table produced
 * by the migrations must appear in exactly one domain — the script
 * fails if the map drifts from the schema. Order = diagram order on
 * the docs index.
 */
const DOMAINS = {
	// packages/db/src/auth.ts — better-auth infrastructure.
	auth: ["account", "session", "user", "verification"],
	// packages/rbac + plugins/rbac — roles, grants and cache epoch.
	rbac: ["permission_epoch", "role_permissions", "roles", "subject_roles"],
	// plugins/patients + plugins/consultations — clinical records.
	clinical: ["consultations", "patients"],
	// plugins/groups — patient cohorts and membership.
	groups: ["group_members", "groups"],
	// Platform-owned: packages/db plugin_state, plugins/notifications,
	// plugins/pages custom pages, plugins/audit admin audit log.
	platform: ["admin_audit", "custom_pages", "notifications", "plugin_state"],
};

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outOverride = outFlag === -1 ? null : resolve(args[outFlag + 1]);
const checkMode = args.includes("--check");

const tblsCandidates = [process.env.TBLS_BIN, "tbls", join(homedir(), "go/bin/tbls")];
let tbls = null;
for (const candidate of tblsCandidates) {
	if (!candidate) continue;
	try {
		execFileSync(candidate, ["version"], { stdio: "pipe" });
		tbls = candidate;
		break;
	} catch {
		// try next
	}
}
if (!tbls) {
	console.error(
		`tbls not found. Install it (go install github.com/k1LoW/tbls@latest, ` +
			`or download a release from https://github.com/k1LoW/tbls) ` +
			`and ensure it is on PATH, or set TBLS_BIN.`,
	);
	process.exit(1);
}

// 1. Apply every drizzle migration to a throwaway SQLite file, in journal order.
const tmp = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
const dbFile = join(tmp, "ktb.db");
{
	const db = new Database(dbFile);
	const files = readdirSync(DRIZZLE_DIR)
		.filter((f) => f.endsWith(".sql"))
		.sort();
	for (const f of files) db.exec(readFileSync(join(DRIZZLE_DIR, f), "utf8"));
	db.close();
	console.log(`applied ${files.length} migrations → ${dbFile}`);
}
const dsn = `sqlite://${dbFile}`;

// 2. tbls doc (SVG ER diagrams + per-table markdown) and tbls out (mermaid).
const stage = join(tmp, "doc");
execFileSync(tbls, ["doc", dsn, stage, "--force"], { stdio: "inherit" });
const mermaidFile = join(tmp, "schema.mmd");
execFileSync(tbls, ["out", dsn, "-t", "mermaid", "-o", mermaidFile], {
	stdio: "inherit",
});

const tables = readdirSync(stage)
	.filter((f) => f.endsWith(".md") && f !== "README.md")
	.map((f) => f.replace(/\.md$/, ""))
	.sort();

// 2b. Per-domain ER diagrams: one filtered tbls doc/out run per domain.
// Fail loudly if DOMAINS drifts from the actual table list.
{
	const assigned = Object.values(DOMAINS).flat();
	const missing = tables.filter((t) => !assigned.includes(t));
	const unknown = assigned.filter((t) => !tables.includes(t));
	const dupes = assigned.filter((t, i) => assigned.indexOf(t) !== i);
	if (missing.length || unknown.length || dupes.length) {
		console.error("DOMAINS map is out of sync with the schema:");
		if (missing.length) console.error(`  tables missing a domain: ${missing.join(", ")}`);
		if (unknown.length) console.error(`  unknown tables: ${unknown.join(", ")}`);
		if (dupes.length) console.error(`  tables in multiple domains: ${dupes.join(", ")}`);
		process.exit(1);
	}
}
const domainArtifacts = {}; // domain -> { svg, mmd } staged file paths
for (const [domain, domainTables] of Object.entries(DOMAINS)) {
	const include = domainTables.join(",");
	const domainStage = join(tmp, `doc-${domain}`);
	execFileSync(
		tbls,
		["doc", dsn, domainStage, "--force", "--include", include],
		{ stdio: "inherit" },
	);
	const svg = join(domainStage, "schema.svg");
	if (!existsSync(svg)) {
		console.error(`tbls doc produced no schema.svg for domain "${domain}"`);
		process.exit(1);
	}
	const mmd = join(tmp, `schema-${domain}.mmd`);
	execFileSync(
		tbls,
		["out", dsn, "-t", "mermaid", "--include", include, "-o", mmd],
		{ stdio: "inherit" },
	);
	domainArtifacts[domain] = { svg, mmd };
}

// 3. Render every target's file set into a staging dir first, then either
// publish (default) or diff (--check). --check never writes to the docs repo.
const targets = outOverride
	? [{ outDir: outOverride, label: outOverride }]
	: LOCALES.map((l) => ({
			outDir: join(DOCS_REPO, "content/docs", l, "developers/reference/database"),
			label: l,
		}));

/** Write the full generated file set for one docs target into `dest`. */
function renderTarget(dest) {
	mkdirSync(dest, { recursive: true });

	for (const f of readdirSync(stage)) {
		if (f.endsWith(".svg")) {
			execFileSync("cp", [join(stage, f), join(dest, f)]);
		}
	}
	execFileSync("cp", [mermaidFile, join(dest, "schema.mmd")]);

	for (const [domain, art] of Object.entries(domainArtifacts)) {
		execFileSync("cp", [art.svg, join(dest, `schema-${domain}.svg`)]);
		execFileSync("cp", [art.mmd, join(dest, `schema-${domain}.mmd`)]);
	}

	for (const table of tables) {
		const src = readFileSync(join(stage, `${table}.md`), "utf8");
		const title = src.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? table.replaceAll("_", " ");
		const body = src.replace(/^#\s+.+\n/, "").replaceAll("](.md)", "](.mdx)");
		writeFileSync(
			join(dest, `${table}.mdx`),
			`---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(
				`Database table \`${table}\` — columns, indexes and relations.`,
			)}\n---\n\n{/* Generated by ${GENERATED_BY} — do not edit. */}\n\n${body}`,
		);
	}

	writeFileSync(
		join(dest, "meta.json"),
		JSON.stringify({ title: "Database", pages: ["index", ...tables] }, null, "\t") + "\n",
	);
}

/** File names this script owns inside a docs target dir. */
function isGeneratedName(f) {
	return (
		f.endsWith(".svg") ||
		f.endsWith(".mmd") ||
		(f.endsWith(".mdx") && f !== "index.mdx") ||
		f.endsWith(".md")
	);
}

if (checkMode) {
	// Regenerate into a temp mirror of the docs tree and diff.
	const checkRoot = join(tmpdir(), `erd-check-${process.pid}`);
	rmSync(checkRoot, { recursive: true, force: true });
	mkdirSync(checkRoot, { recursive: true });
	let failures = 0;

	for (const { outDir, label } of targets) {
		const staged = join(checkRoot, label.replaceAll("/", "_"));
		renderTarget(staged);

		const expected = new Set(readdirSync(staged));
		const actual = existsSync(outDir) ? readdirSync(outDir) : [];

		for (const f of actual) {
			if (isGeneratedName(f) && !expected.has(f)) {
				console.error(`  [${label}] stale generated file not in regen: ${f}`);
				failures++;
			}
		}
		for (const f of expected) {
			const target = join(outDir, f);
			if (!existsSync(target)) {
				console.error(`  [${label}] missing generated file: ${f}`);
				failures++;
				continue;
			}
			const a = readFileSync(join(staged, f), "utf8");
			const b = readFileSync(target, "utf8");
			if (a !== b) {
				console.error(`  [${label}] content differs: ${f}`);
				failures++;
			}
		}
	}

	rmSync(checkRoot, { recursive: true, force: true });
	if (failures) {
		console.error(
			`\ncheck FAILED: ${failures} difference(s). Run \`bun run db:erd\` ` +
				`from the product repo and commit the regenerated docs.`,
		);
		process.exit(1);
	}
	console.log("check passed: generated docs are up to date.");
} else {
	for (const { outDir } of targets) {
		mkdirSync(outDir, { recursive: true });

		// Remove previously generated artifacts; keep hand-written files
		// (index.mdx) and meta.json (rewritten by renderTarget).
		for (const f of readdirSync(outDir)) {
			if (isGeneratedName(f)) rmSync(join(outDir, f));
		}

		renderTarget(outDir);
		console.log(
			`wrote ${tables.length} table pages + ${Object.keys(DOMAINS).length + 1} ER diagrams → ${outDir}`,
		);
	}
}

rmSync(tmp, { recursive: true, force: true });
console.log("done.");
