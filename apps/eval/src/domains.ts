/**
 * domains.ts — domain-pack definition discovery + resolution (P-079).
 *
 * Domain packs are mostly data: each `evals/<domain>/` may carry a
 * `domain.ts` exporting a `defineDomain`-validated DomainDefinition
 * (eval-core domain.ts). This loader mirrors suites.ts: recursive
 * scan for the `domain.ts` convention file, re-validated through
 * `validateDomain`, dynamic import (type stripping on Bun and
 * Node ≥ 23.6).
 *
 * Resolution answers, for a suite manifest's `domain` id:
 *
 *   1. Which definition (and `extends` chain) backs the id?
 *   2. What do manifest `domainParams` overrides merge into?
 *   3. Which pack directories do pack-relative paths (templates.dir)
 *      resolve against — leaf first, then each ancestor's dir.
 *
 * A suite whose `domain` has NO definition still runs: commands fall
 * back to the pre-P-079 defaults (pt-BR, DEFAULT_MATRIX, the
 * consultation template dir). `domainParams` without a resolvable
 * domain is still honored — it merges over a synthetic empty
 * definition, so params-only domains need no domain.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
	mergeDomainDefinitions,
	validateDomain,
	validateDomainOverrides,
	type DomainDefinition,
	type DomainOverrides,
	type EvalSuiteManifest,
} from "@ktb/eval-core";

export interface LoadedDomain {
	readonly file: string;
	/** Pack root — nearest ancestor containing package.json (the
	 * domain.ts may live in src/); falls back to the file's own dir
	 * for fixture packs without one. Base for pack-relative paths. */
	readonly dir: string;
	readonly definition: DomainDefinition;
}

/** The export name every domain module must provide. */
const DOMAIN_EXPORT = "domain";

/** Pack root for a domain.ts — walk up from the file's directory to
 * the nearest package.json (evals/<domain>/package.json); a domain
 * file with no package.json ancestor (test fixtures) uses its own
 * directory. */
const packDirOf = (file: string): string => {
	let d = path.dirname(file);
	for (;;) {
		if (fs.existsSync(path.join(d, "package.json"))) return d;
		const parent = path.dirname(d);
		if (parent === d) return path.dirname(file);
		d = parent;
	}
};

/** Sorted `domain.ts` files under `dir`, recursively — same walk as
 * suites.ts (node_modules/dot-dirs skipped). */
export const listDomainFiles = (dir: string): readonly string[] => {
	if (!fs.existsSync(dir)) {
		throw new Error(`domain directory not found: ${dir}`);
	}
	const out: string[] = [];
	const walk = (d: string): void => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile() && entry.name === "domain.ts") {
				out.push(full);
			}
		}
	};
	walk(dir);
	return out.sort();
};

/** Import one domain module and validate its `domain` export. Any
 * failure — missing export, schema violation, import error — is a
 * hard error naming the file. */
export const loadDomainFile = async (file: string): Promise<LoadedDomain> => {
	let mod: Record<string, unknown>;
	try {
		mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
	} catch (cause) {
		throw new Error(`failed to import domain ${file}: ${String(cause)}`, { cause });
	}
	const candidate = mod[DOMAIN_EXPORT] ?? mod.default;
	const definition = validateDomain(candidate);
	if (definition === null) {
		throw new Error(
			`domain ${file}: export "${DOMAIN_EXPORT}" is missing or not a valid DomainDefinition`,
		);
	}
	return { file, dir: packDirOf(file), definition };
};

/** Load + validate every domain definition in `dir`. */
export const loadDomains = async (dir: string): Promise<readonly LoadedDomain[]> =>
	Promise.all(listDomainFiles(dir).map(loadDomainFile));

/** A suite's effective domain: the chain-merged definition plus the
 * manifest's `domainParams` overrides applied, and the chain's pack
 * directories (leaf first) for pack-relative path resolution. */
export interface EffectiveDomain {
	readonly id: string;
	readonly definition: DomainDefinition;
	/** Pack dirs leaf→root — `templates.dir` resolves against the
	 * first dir where the relative path exists. Empty when the domain
	 * id has no definition (params-only domain). */
	readonly dirs: readonly string[];
}

/** JSON helpers for reading `params` — the bag is open JSON, so
 * consumers narrow defensively (a wrong-typed param is ignored,
 * never trusted). */
export const jsonRecord = (v: unknown): Readonly<Record<string, unknown>> | undefined =>
	typeof v === "object" && v !== null && !Array.isArray(v)
		? (v as Readonly<Record<string, unknown>>)
		: undefined;

export const jsonString = (v: unknown): string | undefined =>
	typeof v === "string" && v !== "" ? v : undefined;

export const jsonNumber = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined;

export const jsonStringArray = (v: unknown): readonly string[] | undefined =>
	Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as readonly string[]) : undefined;

/** Human-readable message for a domain resolution failure —
 * `domainForManifest` only throws Error; the fallback is defensive. */
export const domainErrorMessage = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/**
 * Resolve a suite manifest's domain: chain-merge the `extends`
 * ancestry, then apply `domainParams` overrides. Returns `undefined`
 * when the domain id has no definition AND the manifest declares no
 * `domainParams` — callers fall back to pre-P-079 defaults. Throws
 * Error on an `extends` cycle/unknown parent (DomainResolutionError)
 * or invalid `domainParams` — both are manifest bugs.
 */
export const domainForManifest = (
	domains: readonly LoadedDomain[],
	manifest: EvalSuiteManifest,
): EffectiveDomain | undefined => {
	const byId = new Map(domains.map((d) => [d.definition.id, d]));
	const overrides: DomainOverrides | undefined =
		manifest.domainParams === undefined
			? undefined
			: (validateDomainOverrides(manifest.domainParams) ?? undefined);
	if (manifest.domainParams !== undefined && overrides === undefined) {
		throw new Error(
			`suite "${manifest.id}" has invalid domainParams — expected a subset of ` +
				`{locale, templates, personas, phi, params}`,
		);
	}

	const leaf = byId.get(manifest.domain);
	if (leaf === undefined && overrides === undefined) return undefined;

	// Chain walk leaf→root over definitions (dirs ride along so
	// inherited pack-relative paths still resolve under the pack that
	// declared them).
	const chain: { dir: string; definition: DomainDefinition }[] = [];
	if (leaf !== undefined) {
		const seen = new Set<string>();
		let cur: LoadedDomain | undefined = leaf;
		for (;;) {
			if (seen.has(cur.definition.id)) {
				throw new Error(`domain "extends" cycle at "${cur.definition.id}"`);
			}
			seen.add(cur.definition.id);
			chain.push({ dir: cur.dir, definition: cur.definition });
			const parentId = cur.definition.extends;
			if (parentId === undefined) break;
			const parent = byId.get(parentId);
			if (parent === undefined) {
				throw new Error(`domain "${cur.definition.id}" extends unknown domain "${parentId}"`);
			}
			cur = parent;
		}
	}

	// Merge root→leaf, then apply the suite's overrides on top.
	let merged: DomainDefinition =
		chain.length === 0
			? { id: manifest.domain, version: "0" }
			: chain[chain.length - 1]!.definition;
	for (let i = chain.length - 2; i >= 0; i--) {
		merged = mergeDomainDefinitions(merged, chain[i]!.definition);
	}
	if (overrides !== undefined) {
		merged = mergeDomainDefinitions(merged, { ...merged, ...overrides });
	}
	return {
		id: manifest.domain,
		definition: merged,
		dirs: chain.map((c) => c.dir),
	};
};
