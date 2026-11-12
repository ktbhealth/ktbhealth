/**
 * ktb architecture rules, enforced by Oxlint JS plugins.
 *
 * Registered via `lint.jsPlugins` in vite.config.ts; each rule is enabled
 * only for the file globs that can violate it (see `lint.overrides`):
 *
 * - `ktb-arch/plugin-contract` — each plugin's `src/index.ts` (server
 *   entry) and `src/client.ts` (client manifest) must export `plugins`,
 *   an array of single-concern plugins each initialized with
 *   `definePlugin({...})` (imported from `@ktb/kernel`), so the host's
 *   filesystem plugin discovery keeps working.
 * - `ktb-arch/client-contract` — `src/client.ts` manifests ship to the
 *   browser bundle: their value imports are restricted to an allowlist
 *   (kernel, UI kit, React/lucide/router primitives and relative .tsx
 *   components). Type-only imports are exempt — they are erased at
 *   build time and never reach the bundle.
 * - `ktb-arch/driver-contract` — any file exporting a `*Driver`/`*Drivers`
 *   descriptor (object or array literal) must import `Driver` from
 *   `@ktb/driver-framework`, keeping port→impl selection typed.
 * - `ktb-arch/provider-lockin` — string literals in port/domain files may
 *   not name a provider (model ids, endpoints); they belong in adapters
 *   or deploy config. Patterns come from tools/arch-policy.mjs.
 * - `ktb-arch/tenant-scope` — tables declared via `tenantTable(...)`
 *   (from @ktb/tenant, conventionally re-exported from schema modules)
 *   are tenant-scoped: raw drizzle queries on them (`.from()`,
 *   `.insert()`, `.update()`, `.delete()`, joins, `db.query.<table>`)
 *   are banned outside the `scopedRepo` factory. Cross-file resolution
 *   covers `import { patients } from "./schema.ts"` and
 *   `@ktb/<pkg>/schema` specifiers; test files are exempt (fixtures may
 *   seed directly).
 * - `ktb-arch/plugin-route-gate` — page route modules under a plugin's
 *   `src/routes` tree must build `Route` via
 *   `createPluginFileRoute("<pkg>.routes")` from `@ktb/server-fns`,
 *   which 404s when the package's routes plugin is disabled (P-058).
 *   Bare `createFileRoute`/`createLazyFileRoute` imports from
 *   `@tanstack/react-router` are banned there; test files are exempt.
 * - `ktb-arch/plugin-api-route-gate` — API/server route modules under a
 *   plugin's `src/api-routes` tree must build `Route` via
 *   `createPluginApiRoute("<pkg>.routes")` (server routes never run
 *   beforeLoad, so the helper wraps `server.handlers` with the same
 *   enabled-state check, answering 404 when the plugin is disabled).
 *   Same bare-creator ban and test exemption as the page gate.
 */

import { PROVIDER_LITERAL_PATTERNS } from "./arch-policy.mjs";

const PLUGIN_ENTRY_RE = /(?:^|[/\\])plugins[/\\][^/\\]+[/\\]src[/\\](?:index|client)\.ts$/;
const CLIENT_ENTRY_RE = /(?:^|[/\\])plugins[/\\][^/\\]+[/\\]src[/\\]client\.ts$/;
const DRIVER_NAME_RE = /Drivers?$/;
const DRIVER_FRAMEWORK = "@ktb/driver-framework";
const KERNEL = "@ktb/kernel";

/**
 * Modules a client manifest may value-import: the kernel contract, the
 * UI kit, and component files (relative .tsx — platform-page wrappers and
 * views). Everything else (plugin index.ts entries, api/fns/schema
 * modules, db/cqrs/server-fns, effect, app-host) is server-side and
 * would drag the server graph into the browser bundle.
 */
const CLIENT_IMPORT_ALLOWLIST = [
	KERNEL,
	"@ktbhealth/",
	"lucide-react",
	"react",
	"react-dom",
	"@tanstack/react-router",
	"@tanstack/virtual-file-routes",
];
const CLIENT_RELATIVE_RE = /^\.\.?\/.*\.tsx$/;

const clientImportAllowed = (source) =>
	CLIENT_IMPORT_ALLOWLIST.some((allowed) =>
		allowed.endsWith("/") ? source.startsWith(allowed) : source === allowed,
	) || CLIENT_RELATIVE_RE.test(source);

const importedName = (spec) => spec.imported?.name ?? spec.imported?.value;

/**
 * Named imports in the file: local binding name → { source, imported }.
 * Covers `import { X }`, `import { X as Y }` and `import type { X }`.
 */
const namedImports = (program) => {
	const map = new Map();
	for (const stmt of program.body) {
		if (stmt.type !== "ImportDeclaration") continue;
		for (const spec of stmt.specifiers ?? []) {
			if (spec.type === "ImportSpecifier" && spec.local?.type === "Identifier") {
				map.set(spec.local.name, {
					source: stmt.source.value,
					imported: importedName(spec),
				});
			}
		}
	}
	return map;
};

/** Whether the file imports `name` (value or type) from `source`. */
const hasNamedImport = (program, source, name) =>
	[...namedImports(program).values()].some(
		(entry) => entry.source === source && entry.imported === name,
	);

/** Top-level variable declarators (`const`/`let`/`var`), keyed by name. */
const topLevelDeclarators = (program) => {
	const decls = new Map();
	for (const stmt of program.body) {
		const declaration =
			stmt.type === "VariableDeclaration"
				? stmt
				: stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "VariableDeclaration"
					? stmt.declaration
					: undefined;
		if (!declaration) continue;
		for (const d of declaration.declarations) {
			if (d.id.type === "Identifier") decls.set(d.id.name, d);
		}
	}
	return decls;
};

/** Names exported from the module (named exports only). */
const exportedNames = (program) => {
	const names = new Set();
	for (const stmt of program.body) {
		if (stmt.type !== "ExportNamedDeclaration") continue;
		const decl = stmt.declaration;
		if (decl?.type === "VariableDeclaration") {
			for (const d of decl.declarations) {
				if (d.id.type === "Identifier") names.add(d.id.name);
			}
		} else if (decl?.id?.type === "Identifier") {
			names.add(decl.id.name);
		}
		for (const spec of stmt.specifiers ?? []) {
			const exported = spec.exported?.name ?? spec.exported?.value;
			if (exported) names.add(exported);
		}
	}
	return names;
};

/**
 * Whether `init` is a `definePlugin({...})` call with `definePlugin`
 * imported from @ktb/kernel.
 */
const isDefinePluginInit = (init, imports) => {
	const callee = init?.type === "CallExpression" ? init.callee : undefined;
	if (
		callee?.type !== "Identifier" ||
		init.arguments.length === 0 ||
		init.arguments[0]?.type !== "ObjectExpression"
	) {
		return false;
	}
	const binding = imports.get(callee.name);
	return binding?.source === KERNEL && binding.imported === "definePlugin";
};

const pluginContract = {
	create(context) {
		return {
			Program(node) {
				if (!PLUGIN_ENTRY_RE.test(context.filename)) return;

				const imports = namedImports(node);
				const decls = topLevelDeclarators(node);
				const declarator = decls.get("plugins");
				const elements =
					declarator?.init?.type === "ArrayExpression" ? declarator.init.elements : undefined;

				if (
					!exportedNames(node).has("plugins") ||
					elements === undefined ||
					elements.length === 0
				) {
					context.report({
						node,
						message:
							"plugin entry must export `plugins` — a non-empty array of `definePlugin({...})` plugins for host discovery",
					});
					return;
				}

				for (const el of elements) {
					// Each element is either an inline `definePlugin({...})`
					// call or a const bound to one.
					const init =
						el?.type === "Identifier"
							? decls.get(el.name)?.init
							: el?.type === "CallExpression"
								? el
								: undefined;
					if (init === undefined || !isDefinePluginInit(init, imports)) {
						context.report({
							node: el ?? node,
							message:
								'`plugins` entries must be `definePlugin({...})` calls or consts initialized with `definePlugin` imported from "@ktb/kernel"',
						});
					}
				}
			},
		};
	},
};

const driverContract = {
	create(context) {
		return {
			Program(node) {
				const decls = topLevelDeclarators(node);
				const exported = exportedNames(node);

				// Driver descriptors are data: object literals (`recallDriver`)
				// or arrays of them (`llmDrivers`). Function exports that merely
				// end in *Driver(s) — e.g. driver-framework's own `resolveDriver`
				// helpers — are not descriptors and are ignored.
				const descriptors = [];
				for (const name of exported) {
					if (!DRIVER_NAME_RE.test(name)) continue;
					const declarator = decls.get(name);
					const init = declarator?.init;
					if (init?.type === "ObjectExpression" || init?.type === "ArrayExpression") {
						descriptors.push(declarator);
					}
				}
				if (descriptors.length === 0) return;

				if (hasNamedImport(node, DRIVER_FRAMEWORK, "Driver")) return;

				for (const d of descriptors) {
					context.report({
						node: d,
						message:
							'files exporting *Driver(s) descriptors must import `Driver` from "@ktb/driver-framework"',
					});
				}
			},
		};
	},
};

const clientContract = {
	create(context) {
		return {
			ImportDeclaration(node) {
				if (!CLIENT_ENTRY_RE.test(context.filename)) return;
				// `import type` is erased at build time — it never reaches
				// the browser bundle, so only value imports are gated.
				if (node.importKind === "type") return;
				const source = node.source?.value;
				if (typeof source !== "string" || clientImportAllowed(source)) return;
				context.report({
					node,
					message: `client manifest may not value-import "${source}" — src/client.ts ships to the browser bundle; keep server code in src/index.ts`,
				});
			},
		};
	},
};

const providerLockin = {
	create(context) {
		return {
			Literal(node) {
				if (typeof node.value !== "string") return;
				if (!PROVIDER_LITERAL_PATTERNS.some((re) => re.test(node.value))) return;
				context.report({
					node,
					message:
						"provider-named literal in port/domain code — move it to an adapter or deploy config (tools/arch-policy.mjs PROVIDER_LITERAL_PATTERNS)",
				});
			},
		};
	},
};

// --- ktb-arch/tenant-scope -------------------------------------------------
// Tenant-scoped tables are declared via `tenantTable(...)` (exported
// from @ktb/tenant, re-exported by schema modules). The rule keeps a
// per-run map of which modules export tenant tables, then flags raw
// drizzle access to those bindings anywhere else. Single-file AST only —
// resolution covers relative specifiers and `@ktb/<pkg>[/<sub>]` mapped
// onto `plugins/<pkg>/src` and `packages/<pkg>/src`.

const TENANT_TABLE_FN = "tenantTable";
const TENANT_PKG = "@ktb/tenant";
const TENANT_SCOPE_METHODS = new Set([
	"from",
	"innerJoin",
	"leftJoin",
	"rightJoin",
	"fullJoin",
	"insert",
	"update",
	"delete",
]);
const TEST_FILE_RE = /\.test\.tsx?$/;

/** repo-relative candidate paths for an import specifier. */
const candidateModules = (source, filename) => {
	const out = [];
	if (source.startsWith(".")) {
		const dir = filename.slice(0, filename.lastIndexOf("/") + 1);
		const resolved = normalizePath(dir + source);
		out.push(resolved, `${resolved}.ts`, `${resolved}/index.ts`);
	} else if (source.startsWith("@ktb/")) {
		const rest = source.slice("@ktb/".length);
		const slash = rest.indexOf("/");
		const pkg = slash === -1 ? rest : rest.slice(0, slash);
		const sub = slash === -1 ? "" : rest.slice(slash + 1);
		for (const base of [`plugins/${pkg}/src`, `packages/${pkg}/src`]) {
			if (sub === "") out.push(`${base}/index.ts`, `${base}/schema.ts`);
			else out.push(`${base}/${sub}.ts`, `${base}/${sub}/index.ts`);
		}
	}
	return out;
};

/** Resolve "." and ".." segments in a "/" -joined path. */
const normalizePath = (path) => {
	const parts = [];
	for (const seg of path.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") parts.pop();
		else parts.push(seg);
	}
	return parts.join("/");
};

/** Whether recorded filename `file` matches repo-relative candidate `cand`. */
const moduleMatches = (file, cand) =>
	file === cand || file.endsWith(`/${cand}`) || cand.endsWith(`/${file}`);

const tenantScope = {
	// filename → Set<exported tenant-table names> (schema modules)
	tableExports: new Map(),
	// filename → Set<local names that resolve to tenant tables
	fileTenantNames: new Map(),

	create(context) {
		const rule = tenantScope;
		return {
			Program(node) {
				if (TEST_FILE_RE.test(context.filename)) return;
				const filename = context.filename;
				const imports = namedImports(node);

				// Local `const x = tenantTable(...)` bindings (exported or
				// not) — same-file raw queries on `x` are banned.
				const local = new Set();
				const exported = new Set();
				const isTenantTableInit = (init) => {
					const callee = init?.type === "CallExpression" ? init.callee : undefined;
					if (callee?.type !== "Identifier") return false;
					if (callee.name === TENANT_TABLE_FN) return true;
					const binding = imports.get(callee.name);
					return (
						binding !== undefined &&
						binding.imported === TENANT_TABLE_FN &&
						(binding.source === TENANT_PKG || binding.source.startsWith(`${TENANT_PKG}/`))
					);
				};
				for (const stmt of node.body) {
					const decl =
						stmt.type === "VariableDeclaration"
							? stmt
							: stmt.type === "ExportNamedDeclaration" &&
								  stmt.declaration?.type === "VariableDeclaration"
								? stmt.declaration
								: undefined;
					const isExport = stmt.type === "ExportNamedDeclaration";
					if (!decl) continue;
					for (const d of decl.declarations) {
						if (d.id.type !== "Identifier" || !isTenantTableInit(d.init)) continue;
						local.add(d.id.name);
						if (isExport) exported.add(d.id.name);
					}
				}
				if (exported.size > 0) rule.tableExports.set(filename, exported);

				// Imported bindings that resolve to tenant-table exports.
				const tenantNames = new Set(local);
				for (const [localName, binding] of imports) {
					for (const cand of candidateModules(binding.source, filename)) {
						for (const [file, names] of rule.tableExports) {
							if (!moduleMatches(file, cand)) continue;
							if (names.has(binding.imported)) tenantNames.add(localName);
						}
					}
				}
				rule.fileTenantNames.set(filename, tenantNames);
			},

			CallExpression(node) {
				const filename = context.filename;
				if (TEST_FILE_RE.test(filename)) return;
				const tenantNames = rule.fileTenantNames?.get(filename);
				if (tenantNames === undefined || tenantNames.size === 0) return;

				const callee = node.callee;
				if (callee?.type !== "MemberExpression" || callee.computed) return;
				const method = callee.property?.name;
				if (typeof method !== "string" || !TENANT_SCOPE_METHODS.has(method)) return;

				const arg = node.arguments[0];
				if (arg?.type !== "Identifier" || !tenantNames.has(arg.name)) return;

				context.report({
					node: arg,
					message:
						`tenant-scoped table "${arg.name}" must be queried through scopedRepo() ` +
						"(@ktb/tenant) — raw drizzle access bypasses tenant isolation " +
						"(ktb-arch/tenant-scope)",
				});
			},

			// Relational query API: db.query.<table>.findMany() etc.
			MemberExpression(node) {
				const filename = context.filename;
				if (TEST_FILE_RE.test(filename)) return;
				const tenantNames = rule.fileTenantNames?.get(filename);
				if (tenantNames === undefined || tenantNames.size === 0) return;
				if (node.computed || node.property?.type !== "Identifier") return;
				if (!tenantNames.has(node.property.name)) return;
				const obj = node.object;
				if (
					obj?.type === "MemberExpression" &&
					!obj.computed &&
					obj.property?.type === "Identifier" &&
					obj.property.name === "query"
				) {
					context.report({
						node,
						message:
							`tenant-scoped table "${node.property.name}" must be queried through ` +
							"scopedRepo() (@ktb/tenant) — db.query.* bypasses tenant isolation " +
							"(ktb-arch/tenant-scope)",
					});
				}
			},
		};
	},
};

// --- ktb-arch/plugin-route-gate + plugin-api-route-gate ---------------------
// Plugin route modules are gated on the package's `*.routes` plugin
// enable state automatically. Page routes (plugins/<pkg>/src/routes/...)
// must build `Route` through `createPluginFileRoute`, which wraps
// `createFileRoute` and throws notFound() when the plugin is off; API
// routes (plugins/<pkg>/src/api-routes/...) must build it through
// `createPluginApiRoute`, which wraps `server.handlers` with the same
// check answering a 404 Response (server routes never run beforeLoad).
// Bare createFileRoute imports are banned so the gate can't be bypassed;
// test files are exempt.

const PLUGIN_PAGE_ROUTE_RE =
	/(?:^|[/\\])plugins[/\\]([^/\\]+)[/\\]src[/\\]routes[/\\].*\.(?:ts|tsx)$/;
const PLUGIN_API_ROUTE_RE =
	/(?:^|[/\\])plugins[/\\]([^/\\]+)[/\\]src[/\\]api-routes[/\\].*\.(?:ts|tsx)$/;
const SERVER_FNS_PKG = "@ktb/server-fns";
const ROUTER_PKG = "@tanstack/react-router";
const BANNED_ROUTE_CREATORS = new Set(["createFileRoute", "createLazyFileRoute"]);

/** Shared rule body; `helperName`/`fileRe` select page vs API gating. */
const makePluginRouteGate = (fileRe, helperName) => ({
	create(context) {
		const match = context.filename.match(fileRe);
		if (match === null || TEST_FILE_RE.test(context.filename)) {
			return {};
		}
		const expectedId = `${match[1]}.routes`;
		// Set by the Program visitor; CallExpression runs after it.
		let imports;
		return {
			Program(node) {
				imports = namedImports(node);

				// Value imports of the bare route creators bypass the gate.
				for (const stmt of node.body) {
					if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") continue;
					if (stmt.source?.value !== ROUTER_PKG) continue;
					for (const spec of stmt.specifiers ?? []) {
						const imported = importedName(spec);
						if (typeof imported === "string" && BANNED_ROUTE_CREATORS.has(imported)) {
							context.report({
								node: spec,
								message:
									`plugin route modules must use ${helperName}("${expectedId}") ` +
									`from "${SERVER_FNS_PKG}" — bare ${imported} bypasses the ` +
									"enabled-state gate (ktb-arch/plugin-route-gate)",
							});
						}
					}
				}

				// Modules that export a Route must build it through the helper.
				if (!exportedNames(node).has("Route")) return;
				const usesHelper = [...imports.values()].some(
					(entry) => entry.source === SERVER_FNS_PKG && entry.imported === helperName,
				);
				if (!usesHelper) {
					context.report({
						node,
						message:
							`plugin route modules must build Route via ` +
							`${helperName}("${expectedId}") from "${SERVER_FNS_PKG}" ` +
							"(ktb-arch/plugin-route-gate)",
					});
				}
			},
			CallExpression(node) {
				const callee = node.callee;
				if (callee?.type !== "Identifier" || imports === undefined) return;
				const binding = imports.get(callee.name);
				if (binding?.source !== SERVER_FNS_PKG || binding.imported !== helperName) return;
				const arg = node.arguments[0];
				if (arg?.type === "Literal" && typeof arg.value === "string" && arg.value !== expectedId) {
					context.report({
						node: arg,
						message:
							`${helperName} must gate on this package's routes plugin id ` +
							`"${expectedId}" (ktb-arch/plugin-route-gate)`,
					});
				}
			},
		};
	},
});

const pluginRouteGate = makePluginRouteGate(PLUGIN_PAGE_ROUTE_RE, "createPluginFileRoute");
const pluginApiRouteGate = makePluginRouteGate(PLUGIN_API_ROUTE_RE, "createPluginApiRoute");

export default {
	meta: { name: "ktb-arch" },
	rules: {
		"plugin-contract": pluginContract,
		"client-contract": clientContract,
		"driver-contract": driverContract,
		"provider-lockin": providerLockin,
		"tenant-scope": tenantScope,
		"plugin-route-gate": pluginRouteGate,
		"plugin-api-route-gate": pluginApiRouteGate,
	},
};
