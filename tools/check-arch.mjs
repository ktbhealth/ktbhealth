/**
 * Architecture-boundary smoke test — proves the ktb-arch lint rules and
 * the arch-policy constants still fire, without running a full lint.
 *
 * Runs the JS-plugin rules from tools/ktb-arch-plugin.js directly against
 * synthetic ESTree-shaped AST nodes (the same shape Oxlint hands to
 * `rule.create(context)` visitors), plus sanity invariants on the policy
 * constants exported by tools/arch-policy.mjs. Fast enough for CI; run
 * locally with `bun run check:arch`.
 */

import {
	IMPL_IMPORT_PATTERNS,
	PLATFORM_GLOBALS,
	PLATFORM_IMPORT_PATTERNS,
	PORT_GLOBS,
	PORT_TEST_GLOBS,
	PROVIDER_LITERAL_PATTERNS,
} from "./arch-policy.mjs";
import plugin from "./ktb-arch-plugin.js";

let failures = 0;
const check = (name, cond) => {
	if (cond) {
		console.log(`ok   ${name}`);
	} else {
		failures += 1;
		console.error(`FAIL ${name}`);
	}
};

// --- arch-policy.mjs invariants -------------------------------------------

check(
	"PORT_GLOBS covers port/domain packages",
	PORT_GLOBS.some((g) => g.includes("packages/{")),
);
check("PORT_GLOBS covers plugins", PORT_GLOBS.includes("plugins/**/*.{ts,tsx}"));
check(
	"PORT_TEST_GLOBS relaxes test files only",
	PORT_TEST_GLOBS.every((g) => g.includes(".test.")),
);
check(
	"platform imports ban node:*/bun:*/deno:*/cloudflare:*/workerd:*",
	["node:*", "bun:*", "deno:*", "cloudflare:*", "workerd:*"].every((p) =>
		PLATFORM_IMPORT_PATTERNS.includes(p),
	),
);
check(
	"platform globals ban process/Bun/Deno",
	["process", "Bun", "Deno"].every((g) => PLATFORM_GLOBALS.includes(g)),
);
check(
	"provider literals cover @cf/* and major provider endpoints",
	PROVIDER_LITERAL_PATTERNS.some((re) => re.test("@cf/meta/llama-3.1-8b")) &&
		PROVIDER_LITERAL_PATTERNS.some((re) => re.test("https://api.anthropic.com/v1")) &&
		PROVIDER_LITERAL_PATTERNS.some((re) => re.test("https://api.openai.com/v1")),
);
check(
	"impl imports ban the composition root and app-host",
	IMPL_IMPORT_PATTERNS.includes("@ktb/app-host") &&
		IMPL_IMPORT_PATTERNS.includes("@ktb/app-host/**") &&
		IMPL_IMPORT_PATTERNS.includes("@ktb/web"),
);
check(
	"impl imports ban every adapter package",
	[
		"auth-better",
		"bot-recall",
		"captcha-stub",
		"captcha-turnstile",
		"email-cloudflare",
		"email-stub",
		"anamnesis-llm",
		"interop-fhir",
		"interop-openehr",
		"transcription-whisper",
		"transcription-webspeech",
		"db-sqlite",
	].every((name) => IMPL_IMPORT_PATTERNS.includes(`@ktb/${name}`)),
);

// --- ktb-arch plugin rules -------------------------------------------------
// Fake Oxlint context: visitors are looked up by node type on the object
// returned from rule.create(context); context.report collects diagnostics.

const makeContext = (filename) => {
	const reports = [];
	return {
		filename,
		reports,
		report: (d) => reports.push(d),
	};
};

const id = (name) => ({ type: "Identifier", name });
const literal = (value) => ({ type: "Literal", value });

const importDecl = (source, names, importKind = "value") => ({
	type: "ImportDeclaration",
	importKind,
	source: literal(source),
	specifiers: names.map((n) => ({
		type: "ImportSpecifier",
		local: id(n.local ?? n.imported ?? n),
		imported: id(n.imported ?? n.local ?? n),
	})),
});

const exportConst = (name, init) => ({
	type: "ExportNamedDeclaration",
	declaration: {
		type: "VariableDeclaration",
		declarations: [{ type: "VariableDeclarator", id: id(name), init }],
	},
});

const program = (body) => ({ type: "Program", body });
const callExpr = (callee, args = [{}]) => ({
	type: "CallExpression",
	callee: id(callee),
	arguments: args.map(() => ({ type: "ObjectExpression", properties: [] })),
});
const runProgramRule = (ruleName, filename, body) => {
	const ctx = makeContext(filename);
	plugin.rules[ruleName].create(ctx).Program(program(body));
	return ctx.reports;
};

// provider-lockin: provider literals in port/domain code are banned.
{
	const ctx = makeContext("packages/kernel/src/port.ts");
	const visitor = plugin.rules["provider-lockin"].create(ctx);
	visitor.Literal(literal("@cf/meta/llama-3.1-8b"));
	visitor.Literal(literal("https://api.openai.com/v1/chat"));
	visitor.Literal(literal("an innocent string"));
	visitor.Literal(literal(42));
	check("provider-lockin flags provider literals", ctx.reports.length === 2);
}

// client-contract: client.ts manifests may only value-import allowlisted
// modules; type imports are exempt.
{
	const filename = "/repo/plugins/consultations/src/client.ts";
	const ctx = makeContext(filename);
	const visitor = plugin.rules["client-contract"].create(ctx);
	visitor.ImportDeclaration(importDecl("@ktb/kernel", ["definePlugin"]));
	visitor.ImportDeclaration(importDecl("@ktb/db", ["db"], "type"));
	visitor.ImportDeclaration({
		type: "ImportDeclaration",
		importKind: "value",
		source: literal("@ktb/db"),
		specifiers: [],
	});
	check("client-contract flags server imports in client.ts", ctx.reports.length === 1);
}

// plugin-contract: entry files must export `plugins` as definePlugin calls.
{
	const ok = runProgramRule("plugin-contract", "/repo/plugins/demo/src/index.ts", [
		importDecl("@ktb/kernel", [{ imported: "definePlugin", local: "definePlugin" }]),
		exportConst("plugins", {
			type: "ArrayExpression",
			elements: [callExpr("definePlugin")],
		}),
	]);
	check("plugin-contract accepts a definePlugin entry", ok.length === 0);

	const missing = runProgramRule("plugin-contract", "/repo/plugins/demo/src/index.ts", [
		exportConst("plugins", { type: "ArrayExpression", elements: [] }),
	]);
	check("plugin-contract flags missing/empty plugins export", missing.length === 1);

	const badEntry = runProgramRule("plugin-contract", "/repo/plugins/demo/src/index.ts", [
		importDecl("@ktb/kernel", [{ imported: "definePlugin", local: "definePlugin" }]),
		exportConst("plugins", {
			type: "ArrayExpression",
			elements: [{ type: "Identifier", name: "notAPlugin" }],
		}),
	]);
	check("plugin-contract flags non-definePlugin entries", badEntry.length === 1);
}

// driver-contract: *Driver(s) descriptors must import Driver from
// @ktb/driver-framework.
{
	const descriptor = {
		type: "ExportNamedDeclaration",
		declaration: {
			type: "VariableDeclaration",
			declarations: [
				{
					type: "VariableDeclarator",
					id: id("recallDriver"),
					init: { type: "ObjectExpression", properties: [] },
				},
			],
		},
	};
	const untyped = runProgramRule("driver-contract", "/repo/packages/bot/src/drivers.ts", [
		descriptor,
	]);
	check("driver-contract flags untyped driver descriptors", untyped.length === 1);

	const typed = runProgramRule("driver-contract", "/repo/packages/bot/src/drivers.ts", [
		importDecl("@ktb/driver-framework", [{ imported: "Driver", local: "Driver" }]),
		descriptor,
	]);
	check("driver-contract accepts typed driver descriptors", typed.length === 0);
}

// tenant-scope: tables declared via tenantTable() may not be queried
// raw — .from()/.insert()/.update()/.delete()/joins/db.query.* are
// reserved for scopedRepo(). Resolution spans schema module → importer.
{
	const memberCall = (method, argName) => ({
		type: "CallExpression",
		callee: {
			type: "MemberExpression",
			computed: false,
			property: id(method),
		},
		arguments: argName === null ? [] : [id(argName)],
	});

	// Schema module declares + exports a tenant table.
	const schemaCtx = makeContext("/repo/plugins/demo/src/schema.ts");
	plugin.rules["tenant-scope"]
		.create(schemaCtx)
		.Program(
			program([
				importDecl("@ktb/tenant", ["tenantTable"]),
				exportConst("docs", callExpr("tenantTable")),
			]),
		);
	check("tenant-scope records tenantTable exports", schemaCtx.reports.length === 0);

	// Service module imports the table and queries it raw.
	const svcCtx = makeContext("/repo/plugins/demo/src/service.ts");
	const svcVisitor = plugin.rules["tenant-scope"].create(svcCtx);
	svcVisitor.Program(program([importDecl("./schema.ts", ["docs"])]));
	svcVisitor.CallExpression(memberCall("from", "docs"));
	svcVisitor.CallExpression(memberCall("insert", "docs"));
	check("tenant-scope flags raw queries on imported tenant tables", svcCtx.reports.length === 2);

	// db.query.docs relational API is flagged too.
	const relCtx = makeContext("/repo/plugins/demo/src/rel.ts");
	const relVisitor = plugin.rules["tenant-scope"].create(relCtx);
	relVisitor.Program(program([importDecl("./schema.ts", ["docs"])]));
	relVisitor.MemberExpression({
		type: "MemberExpression",
		computed: false,
		property: id("docs"),
		object: {
			type: "MemberExpression",
			computed: false,
			property: id("query"),
			object: id("db"),
		},
	});
	check("tenant-scope flags db.query.<tenantTable>", relCtx.reports.length === 1);

	// Non-tenant tables and unrelated identifiers pass.
	const okCtx = makeContext("/repo/plugins/demo/src/ok.ts");
	const okVisitor = plugin.rules["tenant-scope"].create(okCtx);
	okVisitor.Program(program([importDecl("./schema.ts", ["docs"])]));
	okVisitor.CallExpression(memberCall("from", "otherTable"));
	okVisitor.CallExpression(memberCall("delete", "docs"));
	check("tenant-scope flags .delete(tenantTable) but not other tables", okCtx.reports.length === 1);

	// Test files are exempt (fixtures seed directly).
	const testCtx = makeContext("/repo/plugins/demo/src/service.test.ts");
	const testVisitor = plugin.rules["tenant-scope"].create(testCtx);
	testVisitor.Program(program([importDecl("./schema.ts", ["docs"])]));
	testVisitor.CallExpression(memberCall("from", "docs"));
	check("tenant-scope exempts test files", testCtx.reports.length === 0);
}

if (failures > 0) {
	console.error(`\n${failures} arch-policy check(s) failed`);
	process.exit(1);
}
console.log("\narch-policy smoke test passed");
