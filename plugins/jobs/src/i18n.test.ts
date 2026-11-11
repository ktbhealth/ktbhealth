import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	JOB_LOCALES,
	jobMessages,
	isJobLocale,
	opsMessages,
	type JobMessages,
	type OpsMessages,
} from "./i18n.ts";

/** Every string leaf of a catalog (functions are exercised separately). */
const leaves = (node: unknown): string[] =>
	typeof node === "string"
		? [node]
		: node && typeof node === "object"
			? Object.values(node).flatMap(leaves)
			: [];

/** Every function leaf of a catalog. */
const functionsOf = (
	node: unknown,
	out: Array<(...args: any[]) => unknown> = [],
): Array<(...args: any[]) => unknown> => {
	if (typeof node === "function") out.push(node as (...args: any[]) => unknown);
	else if (node !== null && typeof node === "object")
		for (const value of Object.values(node)) functionsOf(value, out);
	return out;
};

describe("job catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isJobLocale("pt-BR")).toBe(true);
		expect(isJobLocale("es")).toBe(true);
		expect(isJobLocale("fr")).toBe(false);
		expect(jobMessages("fr")).toBe(jobMessages(BASE_LOCALE));
		expect(jobMessages("pt-BR").label).toBe("Tarefas em segundo plano");
	});

	it("has no blank copy in any locale", () => {
		for (const locale of JOB_LOCALES) {
			expect(leaves(jobMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("formats active counts and consultation refs in every locale", () => {
		const expected: Record<string, [string, string]> = {
			en: ["3 active", "consultation #7"],
			"pt-BR": ["3 ativas", "consulta #7"],
			es: ["3 activas", "consulta #7"],
		};
		for (const locale of JOB_LOCALES) {
			const m = jobMessages(locale) as JobMessages;
			const [active, ref] = expected[locale]!;
			expect(m.activeCount(3)).toBe(active);
			expect(m.consultationRef(7)).toBe(ref);
		}
	});

	it("every catalog function returns copy in every locale", () => {
		for (const locale of JOB_LOCALES) {
			for (const fn of functionsOf(jobMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});

describe("ops catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(opsMessages("pt-BR").title).toBe("Operações");
		expect(opsMessages("es").title).toBe("Operaciones");
		expect(opsMessages("fr")).toBe(opsMessages(BASE_LOCALE));
	});

	it("has no blank copy in any locale", () => {
		for (const locale of JOB_LOCALES) {
			expect(leaves(opsMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});

	it("formats the job-count, storage-count and retry-ref strings", () => {
		const expected: Record<string, [string, string, string]> = {
			en: [
				"3 audio pipeline jobs tracked.",
				"3 objects",
				"Re-enqueue the transcription job for #7.",
			],
			"pt-BR": [
				"3 tarefas do pipeline de áudio monitoradas.",
				"3 objetos",
				"Reenfileirar a tarefa de transcrição de #7.",
			],
			es: [
				"3 tareas del pipeline de audio monitorizadas.",
				"3 objetos",
				"Volver a encolar la tarea de transcripción de #7.",
			],
		};
		for (const locale of JOB_LOCALES) {
			const m = opsMessages(locale) as OpsMessages;
			const [description, objects, retry] = expected[locale]!;
			expect(m.description(3)).toBe(description);
			expect(m.storageObjects(3)).toBe(objects);
			expect(m.retryDescription("#7").startsWith(retry.slice(0, 20))).toBe(true);
			// singular forms
			expect(m.description(1)).toContain("1 ");
			expect(m.storageObjects(1)).toBe(locale === "en" ? "1 object" : "1 objeto");
		}
	});

	it("every ops catalog function returns copy in every locale", () => {
		for (const locale of JOB_LOCALES) {
			for (const fn of functionsOf(opsMessages(locale))) {
				for (const args of [[1], [2], ["x"], [0]]) {
					expect(typeof fn(...args)).toBe("string");
				}
			}
		}
	});
});
