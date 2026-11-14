import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { defineSuite } from "@ktb/eval-core";

import {
	domainErrorMessage,
	domainForManifest,
	jsonNumber,
	jsonRecord,
	jsonString,
	jsonStringArray,
	listDomainFiles,
	loadDomainFile,
	loadDomains,
} from "./domains.ts";

let dir = "";

const write = (name: string, body: string) => {
	const full = path.join(dir, name);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, body);
};

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-domains-"));
	// Base domain pack — src/domain.ts under a package root, like
	// evals/consultation.
	write("base/package.json", `{ "name": "@ktb/eval-base", "private": true, "type": "module" }`);
	write(
		"base/src/domain.ts",
		`export const domain = {
			id: "eval.base",
			version: "1",
			provides: { metrics: ["m1"], conditions: ["c1"] },
			locale: { profile: "base-v1", tag: "base-BR" },
			templates: { dir: "templates", name: "base" },
			personas: { regions: ["r1", "r2"], ageBands: ["a"], registers: ["f"], specialties: ["s"] },
			phi: { categories: ["cpf"] },
			params: { dataset: { count: 8, step: 7 }, voices: ["v1"], keep: { deep: 1 } },
		 };`,
	);
	// Variant pack — extends base, overrides params only (the P-079
	// proof: no code fork).
	write(
		"variant/package.json",
		`{ "name": "@ktb/eval-variant", "private": true, "type": "module" }`,
	);
	write(
		"variant/src/domain.ts",
		`export const domain = {
			id: "eval.variant",
			version: "1",
			extends: "eval.base",
			personas: { regions: ["r9"], ageBands: ["a"], registers: ["f"], specialties: ["s"] },
			params: { dataset: { count: 2 }, cohort: "variant" },
		 };`,
	);
	write("broken/src/domain.ts", `export const domain = { nope: true };`);
	write("noexport/src/domain.ts", `export const other = 1;`);
	write(
		"orphan/src/domain.ts",
		`export const domain = { id: "eval.orphan", version: "1", extends: "eval.ghost" };`,
	);
	write(
		"cycA/src/domain.ts",
		`export const domain = { id: "eval.cycA", version: "1", extends: "eval.cycB" };`,
	);
	write(
		"cycB/src/domain.ts",
		`export const domain = { id: "eval.cycB", version: "1", extends: "eval.cycA" };`,
	);
	write("plain.ts", `export const domain = 1;`);
	write("badimport/src/domain.ts", `throw new Error("import boom");`);
	fs.mkdirSync(path.join(dir, "node_modules", "ignored"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "node_modules", "ignored", "domain.ts"),
		`export const domain = 1;`,
	);
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("domain discovery", () => {
	test("listDomainFiles finds domain.ts recursively, skipping node_modules", () => {
		const files = listDomainFiles(dir);
		expect(files.some((f) => f.endsWith(path.join("base", "src", "domain.ts")))).toBe(true);
		expect(files.some((f) => f.includes("node_modules"))).toBe(false);
		expect(files.some((f) => f.endsWith("plain.ts"))).toBe(false);
	});

	test("listDomainFiles throws on a missing directory", () => {
		expect(() => listDomainFiles(path.join(dir, "ghost"))).toThrow(/domain directory not found/);
	});

	test("loadDomains validates and resolves pack dirs", async () => {
		const domains = await loadDomains(path.join(dir, "base"));
		expect(domains).toHaveLength(1);
		// src/domain.ts → pack root is the package.json dir.
		expect(domains[0]!.dir).toBe(path.join(dir, "base"));
		expect(domains[0]!.definition.id).toBe("eval.base");
	});

	test("loadDomainFile rejects missing/invalid exports", async () => {
		await expect(loadDomainFile(path.join(dir, "broken", "src", "domain.ts"))).rejects.toThrow(
			/not a valid DomainDefinition/,
		);
		await expect(loadDomainFile(path.join(dir, "noexport", "src", "domain.ts"))).rejects.toThrow(
			/not a valid DomainDefinition/,
		);
		// A module that throws during evaluation fails the import.
		await expect(loadDomainFile(path.join(dir, "badimport", "src", "domain.ts"))).rejects.toThrow(
			/failed to import domain/,
		);
	});
});

const manifest = (over?: Record<string, unknown>) =>
	defineSuite({
		id: "s",
		domain: "eval.base",
		dataset: { id: "d", version: "1" },
		stages: [],
		caps: {},
		metrics: [],
		gates: [],
		schemaVersion: 1,
		...over,
	});

describe("domainForManifest", () => {
	const loadAll = async () => {
		const base = await loadDomainFile(path.join(dir, "base", "src", "domain.ts"));
		const variant = await loadDomainFile(path.join(dir, "variant", "src", "domain.ts"));
		return [base, variant];
	};

	test("resolves a definition with chain dirs leaf-first", async () => {
		const domains = await loadAll();
		const eff = domainForManifest(domains, manifest());
		expect(eff?.definition.id).toBe("eval.base");
		expect(eff?.dirs).toEqual([path.join(dir, "base")]);
	});

	test("extends merges parent data; child params/sections win", async () => {
		const domains = await loadAll();
		const eff = domainForManifest(domains, manifest({ domain: "eval.variant" }));
		expect(eff?.definition.id).toBe("eval.variant");
		// Inherited contribution vocabulary + locale/templates/phi.
		expect(eff?.definition.provides?.metrics).toEqual(["m1"]);
		expect(eff?.definition.locale).toEqual({ profile: "base-v1", tag: "base-BR" });
		// Child personas replace wholesale.
		expect(eff?.definition.personas?.regions).toEqual(["r9"]);
		// Params deep-merge: count overridden, step/voices/keep kept,
		// cohort added.
		expect(eff?.definition.params).toEqual({
			dataset: { count: 2, step: 7 },
			voices: ["v1"],
			keep: { deep: 1 },
			cohort: "variant",
		});
		// Chain dirs leaf→root: variant's own dir first, then base's —
		// inherited templates.dir still resolves under the parent pack.
		expect(eff?.dirs).toEqual([path.join(dir, "variant"), path.join(dir, "base")]);
	});

	test("domainParams overrides merge over the resolved definition", async () => {
		const domains = await loadAll();
		const eff = domainForManifest(
			domains,
			manifest({
				domainParams: {
					personas: { regions: ["rx"], ageBands: ["a"], registers: ["f"], specialties: ["s"] },
					params: { dataset: { count: 1 }, entityCategories: ["medication"] },
				},
			}),
		);
		expect(eff?.definition.personas?.regions).toEqual(["rx"]);
		expect(eff?.definition.params).toMatchObject({
			dataset: { count: 1, step: 7 },
			entityCategories: ["medication"],
			voices: ["v1"],
		});
	});

	test("unknown domain without domainParams → undefined (caller defaults)", async () => {
		const domains = await loadAll();
		expect(domainForManifest(domains, manifest({ domain: "eval.ghost" }))).toBeUndefined();
	});

	test("domainParams without a definition still applies (params-only domain)", async () => {
		const domains = await loadAll();
		const eff = domainForManifest(
			domains,
			manifest({ domain: "eval.ghost", domainParams: { params: { cohort: "x" } } }),
		);
		expect(eff?.definition.id).toBe("eval.ghost");
		expect(eff?.definition.params).toEqual({ cohort: "x" });
		expect(eff?.dirs).toEqual([]);
	});

	test("invalid domainParams and broken extends chains throw", async () => {
		const domains = await loadAll();
		expect(() => domainForManifest(domains, manifest({ domainParams: { provides: {} } }))).toThrow(
			/invalid domainParams/,
		);
		expect(() => domainForManifest(domains, manifest({ domainParams: { bogus: 1 } }))).toThrow(
			/invalid domainParams/,
		);
		// extends → unknown parent.
		const orphan = await loadDomainFile(path.join(dir, "orphan", "src", "domain.ts"));
		expect(() =>
			domainForManifest([...domains, orphan], manifest({ domain: "eval.orphan" })),
		).toThrow(/extends unknown domain "eval.ghost"/);
		// extends cycle.
		const cycA = await loadDomainFile(path.join(dir, "cycA", "src", "domain.ts"));
		const cycB = await loadDomainFile(path.join(dir, "cycB", "src", "domain.ts"));
		expect(() =>
			domainForManifest([...domains, cycA, cycB], manifest({ domain: "eval.cycA" })),
		).toThrow(/cycle/);
	});
});

describe("json param helpers", () => {
	test("narrow defensively", () => {
		expect(jsonRecord({ a: 1 })).toEqual({ a: 1 });
		expect(jsonRecord([1])).toBeUndefined();
		expect(jsonRecord("x")).toBeUndefined();
		expect(jsonString("s")).toBe("s");
		expect(jsonString("")).toBeUndefined();
		expect(jsonNumber(2)).toBe(2);
		expect(jsonNumber(Number.NaN)).toBeUndefined();
		expect(jsonStringArray(["a"])).toEqual(["a"]);
		expect(jsonStringArray(["a", 1])).toBeUndefined();
		expect(domainErrorMessage(new Error("m"))).toBe("m");
		expect(domainErrorMessage("raw")).toBe("raw");
	});
});
