/**
 * ktb architecture rules, enforced by Oxlint JS plugins.
 *
 * Registered via `lint.jsPlugins` in vite.config.ts; each rule is enabled
 * only for the file globs that can violate it (see `lint.overrides`):
 *
 * - `ktb-arch/plugin-contract` — each plugin's `src/index.ts` must export
 *   `const plugin = definePlugin({...})` with `definePlugin` imported from
 *   `@ktb/kernel`, so the host's filesystem plugin discovery keeps working.
 * - `ktb-arch/driver-contract` — any file exporting a `*Driver`/`*Drivers`
 *   descriptor (object or array literal) must import `Driver` from
 *   `@ktb/driver-framework`, keeping port→impl selection typed.
 */

const PLUGIN_ENTRY_RE = /(?:^|[/\\])plugins[/\\][^/\\]+[/\\]src[/\\]index\.ts$/;
const DRIVER_NAME_RE = /Drivers?$/;
const DRIVER_FRAMEWORK = "@ktb/driver-framework";
const KERNEL = "@ktb/kernel";

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

const pluginContract = {
	create(context) {
		return {
			Program(node) {
				if (!PLUGIN_ENTRY_RE.test(context.filename)) return;

				const imports = namedImports(node);
				const decls = topLevelDeclarators(node);
				const declarator = decls.get("plugin");

				if (!exportedNames(node).has("plugin") || declarator === undefined) {
					context.report({
						node,
						message:
							"plugin entry must export `const plugin = definePlugin({...})` — the host discovers plugins by this export",
					});
					return;
				}

				const init = declarator.init;
				const callee = init?.type === "CallExpression" ? init.callee : undefined;
				if (
					callee?.type !== "Identifier" ||
					init.arguments.length === 0 ||
					init.arguments[0]?.type !== "ObjectExpression"
				) {
					context.report({
						node: declarator,
						message: "`plugin` must be initialized with `definePlugin({...})`",
					});
					return;
				}

				const binding = imports.get(callee.name);
				if (binding?.source !== KERNEL || binding.imported !== "definePlugin") {
					context.report({
						node: callee,
						message: `\`${callee.name}\` must be \`definePlugin\` imported from "${KERNEL}" — plugin metadata is defined by the kernel contract`,
					});
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

export default {
	meta: { name: "ktb-arch" },
	rules: {
		"plugin-contract": pluginContract,
		"driver-contract": driverContract,
	},
};
