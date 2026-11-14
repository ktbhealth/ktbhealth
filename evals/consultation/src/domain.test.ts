import { describe, expect, it } from "vitest";

import { refIdOf, type ContributionRef } from "@ktb/eval-core";

import { consultContributions, domain } from "./index.ts";
import { ptBR } from "./locales/pt-BR.ts";
import { DEFAULT_MATRIX } from "./personas.ts";

/**
 * domain.ts consistency (P-079): the definition is data, but it must
 * not drift from the code it names — every provides id maps to a
 * registered consultContributions entry (metrics/gates/presets/
 * conditions) or the capability-plugin stage vocabulary.
 */
describe("domain definition", () => {
	it("provides ids match the pack's registered contributions", () => {
		const byKind = new Map<string, Set<string>>();
		for (const c of consultContributions) {
			const set = byKind.get(c.kind) ?? new Set<string>();
			set.add(c.id);
			byKind.set(c.kind, set);
		}
		const ids = (entries: readonly (string | ContributionRef)[] | undefined) =>
			(entries ?? []).map(refIdOf);
		for (const id of ids(domain.provides?.metrics)) {
			expect(byKind.get("eval.metric")?.has(id), `metric ${id}`).toBe(true);
		}
		for (const id of ids(domain.provides?.gatePresets)) {
			expect(byKind.get("eval.gatepreset")?.has(id), `gatepreset ${id}`).toBe(true);
		}
		for (const id of ids(domain.provides?.conditions)) {
			expect(byKind.get("eval.condition")?.has(id), `condition ${id}`).toBe(true);
		}
		for (const g of domain.provides?.gates ?? []) {
			if (g.id !== undefined) {
				expect(byKind.get("eval.gate")?.has(g.id), `gate ${g.id}`).toBe(true);
			}
		}
	});

	it("binds the pt-BR locale, template dir, matrix and PHI categories", () => {
		expect(domain.id).toBe("eval.consultation");
		expect(domain.locale?.profile).toBe(ptBR.id);
		expect(domain.locale?.tag).toBe("pt-BR");
		expect(domain.templates).toEqual({ dir: "templates", name: "consultation" });
		expect(domain.personas).toEqual(DEFAULT_MATRIX);
		expect(domain.phi?.categories).toEqual(["cpf", "phone", "email", "date_of_birth"]);
	});

	it("declares generator defaults under params.dataset", () => {
		const ds = domain.params?.dataset as Record<string, unknown> | undefined;
		expect(ds).toMatchObject({ count: 8, step: 7, seed: 100, noise: "clean" });
		expect(domain.params?.voices).toEqual(["br_male_1", "br_female_1"]);
	});
});
