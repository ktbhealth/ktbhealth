import { describe, expect, it } from "vitest";

import {
	defineDomain,
	domainChain,
	DomainResolutionError,
	mergeDomainDefinitions,
	mergeDomainParams,
	mergeJson,
	resolveDomainDefinition,
	validateDomain,
	validateDomainOverrides,
	type DomainDefinition,
} from "./domain.ts";

const base: DomainDefinition = defineDomain({
	id: "eval.base",
	version: "1",
	provides: {
		stages: ["s1", { id: "s2", config: { a: 1 } }],
		metrics: ["m1"],
		gates: [{ id: "g1", config: { x: 1 } }],
		gatePresets: ["p1"],
		conditions: ["c1"],
		capabilities: { tts: "plug.a" },
	},
	locale: { profile: "ptbr-v1", tag: "pt-BR" },
	templates: { dir: "templates", name: "consultation" },
	personas: { regions: ["r1"], ageBands: ["a"], registers: ["f"], specialties: ["s"] },
	phi: { categories: ["cpf"] },
	params: { dataset: { count: 8, step: 7 }, voices: ["v1"], cohort: "base" },
});

describe("validateDomain / defineDomain", () => {
	it("accepts a full definition and rejects bad shapes", () => {
		expect(validateDomain(base)).not.toBeNull();
		expect(validateDomain(null)).toBeNull();
		expect(validateDomain({ id: "x" })).toBeNull();
		expect(validateDomain({ ...base, bogus: 1 })).toBeNull();
		expect(validateDomain({ ...base, personas: { regions: "nope" } })).toBeNull();
		expect(() => defineDomain({ nope: true })).toThrow();
	});
});

describe("validateDomainOverrides", () => {
	it("accepts the overridable subset only", () => {
		expect(validateDomainOverrides({ params: { a: 1 }, locale: { profile: "p" } })).not.toBeNull();
		expect(validateDomainOverrides({ provides: {} })).toBeNull();
		expect(validateDomainOverrides({ extends: "x" })).toBeNull();
		expect(validateDomainOverrides({ id: "x" })).toBeNull();
		expect(validateDomainOverrides("nope")).toBeNull();
		expect(validateDomainOverrides({ personas: { regions: 1 } })).toBeNull();
	});
});

describe("mergeJson / mergeDomainParams", () => {
	it("deep-merges records, replaces arrays/scalars", () => {
		expect(mergeJson(undefined, undefined)).toBeUndefined();
		expect(mergeJson({ a: 1 }, undefined)).toEqual({ a: 1 });
		expect(mergeJson(undefined, { a: 1 })).toEqual({ a: 1 });
		expect(
			mergeJson(
				{ nested: { x: 1, y: 2 }, list: [1, 2], keep: "a" },
				{ nested: { y: 3, z: 4 }, list: [9], keep: "b" },
			),
		).toEqual({ nested: { x: 1, y: 3, z: 4 }, list: [9], keep: "b" });
		expect(mergeJson({ a: [1] }, { a: null })).toEqual({ a: null });
		// Null-prototype records still count as plain objects.
		const nilProto = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
		expect(mergeJson(nilProto as never, { b: 2 })).toEqual({ a: 1, b: 2 });
	});

	it("mergeDomainParams treats undefined as absent", () => {
		expect(mergeDomainParams(undefined, undefined)).toBeUndefined();
		expect(mergeDomainParams(undefined, { a: 1 })).toEqual({ a: 1 });
		expect(mergeDomainParams({ a: 1 }, undefined)).toEqual({ a: 1 });
		expect(mergeDomainParams({ d: { x: 1 } }, { d: { y: 2 } })).toEqual({
			d: { x: 1, y: 2 },
		});
	});
});

describe("mergeDomainDefinitions", () => {
	const child = defineDomain({
		id: "eval.child",
		version: "2",
		extends: "eval.base",
		provides: {
			stages: ["s3", { id: "s2", config: { a: 9 } }],
			metrics: ["m2"],
		},
		personas: { regions: ["r2"], ageBands: ["b"], registers: ["c"], specialties: ["t"] },
		params: { dataset: { count: 4 }, extra: true },
	});

	it("unions provides by id with child config winning", () => {
		const m = mergeDomainDefinitions(base, child);
		expect(m.id).toBe("eval.child");
		expect(m.version).toBe("2");
		// stages: s1 kept, s2 child's config wins, s3 appended.
		expect(m.provides?.stages).toEqual(["s1", { id: "s2", config: { a: 9 } }, "s3"]);
		// metrics union preserves order.
		expect(m.provides?.metrics).toEqual(["m1", "m2"]);
		// untouched kinds inherit wholesale.
		expect(m.provides?.gates).toEqual([{ id: "g1", config: { x: 1 } }]);
		expect(m.provides?.capabilities).toEqual({ tts: "plug.a" });
	});

	it("replaces declared sections wholesale, inherits the rest", () => {
		const m = mergeDomainDefinitions(base, child);
		expect(m.personas?.regions).toEqual(["r2"]);
		// locale/templates/phi not redeclared → inherited.
		expect(m.locale).toEqual({ profile: "ptbr-v1", tag: "pt-BR" });
		expect(m.templates).toEqual({ dir: "templates", name: "consultation" });
		expect(m.phi).toEqual({ categories: ["cpf"] });
	});

	it("deep-merges params with child winning leaf conflicts", () => {
		const m = mergeDomainDefinitions(base, child);
		expect(m.params).toEqual({
			dataset: { count: 4, step: 7 },
			voices: ["v1"],
			cohort: "base",
			extra: true,
		});
	});

	it("gate entries union by id/preset key", () => {
		const p = defineDomain({
			id: "p",
			version: "1",
			provides: { gates: [{ id: "g1", config: { old: true } }, { preset: "px" }] },
		});
		const c = defineDomain({
			id: "c",
			version: "1",
			provides: { gates: [{ id: "g1", config: { new: true } }, { id: "g2" }] },
		});
		const m = mergeDomainDefinitions(p, c);
		expect(m.provides?.gates).toEqual([
			{ id: "g1", config: { new: true } },
			{ preset: "px" },
			{ id: "g2" },
		]);
	});

	it("handles one-sided provides sections and absent capabilities", () => {
		// provides only on the child → inherited wholesale.
		const onlyChild = mergeDomainDefinitions(
			defineDomain({ id: "p", version: "1" }),
			defineDomain({
				id: "c",
				version: "1",
				provides: {
					gates: [{ preset: "px" }],
					capabilities: { llm: "plug.b" },
				},
			}),
		);
		expect(onlyChild.provides?.gates).toEqual([{ preset: "px" }]);
		expect(onlyChild.provides?.capabilities).toEqual({ llm: "plug.b" });

		// provides only on the parent → inherited wholesale; kinds the
		// child redeclares union, undeclared kinds pass through.
		const onlyParent = mergeDomainDefinitions(base, defineDomain({ id: "c", version: "1" }));
		expect(onlyParent.provides?.stages).toEqual(base.provides?.stages);
		expect(onlyParent.provides?.capabilities).toEqual({ tts: "plug.a" });

		// Both declare provides but neither names capabilities → the
		// merged provides omits the key entirely.
		const noCaps = mergeDomainDefinitions(
			defineDomain({ id: "p", version: "1", provides: { metrics: ["m"] } }),
			defineDomain({ id: "c", version: "1", provides: { conditions: ["k"] } }),
		);
		expect(noCaps.provides).toEqual({ metrics: ["m"], conditions: ["k"] });
		expect(noCaps.provides && "capabilities" in noCaps.provides).toBe(false);

		// Gates declared only on the child union into parent provides
		// that lacks the kind entirely.
		const childGates = mergeDomainDefinitions(
			defineDomain({ id: "p", version: "1", provides: { metrics: ["m"] } }),
			defineDomain({ id: "c", version: "1", provides: { gates: [{ id: "g" }] } }),
		);
		expect(childGates.provides?.gates).toEqual([{ id: "g" }]);
	});

	it("child sections replace parent sections; absent sections inherit nothing", () => {
		// Neither side declares templates/personas/phi → merged omits them.
		const bare = mergeDomainDefinitions(
			defineDomain({ id: "p", version: "1", params: { a: 1 } }),
			defineDomain({ id: "c", version: "1", params: { b: 2 } }),
		);
		expect(bare.templates).toBeUndefined();
		expect(bare.personas).toBeUndefined();
		expect(bare.phi).toBeUndefined();
		expect(bare.locale).toBeUndefined();
		expect(bare.params).toEqual({ a: 1, b: 2 });
	});
});

describe("domainChain / resolveDomainDefinition", () => {
	const defs = [
		base,
		defineDomain({
			id: "eval.mid",
			version: "1",
			extends: "eval.base",
			params: { mid: true },
		}),
		defineDomain({
			id: "eval.leaf",
			version: "1",
			extends: "eval.mid",
			params: { leaf: true },
		}),
	];

	it("returns leaf→root order", () => {
		const chain = domainChain(defs, "eval.leaf");
		expect(chain.map((d) => d.id)).toEqual(["eval.leaf", "eval.mid", "eval.base"]);
	});

	it("merges root→leaf", () => {
		const m = resolveDomainDefinition(defs, "eval.leaf");
		expect(m.id).toBe("eval.leaf");
		expect(m.params).toEqual({
			dataset: { count: 8, step: 7 },
			voices: ["v1"],
			cohort: "base",
			mid: true,
			leaf: true,
		});
		expect(m.provides?.metrics).toEqual(["m1"]);
	});

	it("throws on unknown id, unknown parent, and cycles", () => {
		expect(() => domainChain(defs, "ghost")).toThrowError(DomainResolutionError);
		// Empty registry → the "(none)" known-list fallback.
		expect(() => domainChain([], "ghost")).toThrowError(/\(none\)/);
		expect(() => domainChain([{ id: "a", version: "1", extends: "ghost" }], "a")).toThrowError(
			/extends unknown domain "ghost"/,
		);
		const cyc = [
			{ id: "a", version: "1", extends: "b" },
			{ id: "b", version: "1", extends: "a" },
		];
		expect(() => domainChain(cyc, "a")).toThrowError(/cycle/);
	});
});
