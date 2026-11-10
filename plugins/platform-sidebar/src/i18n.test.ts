import { describe, expect, it } from "vitest";

import { BASE_LOCALE, CONSOLE_LOCALES, consoleMessages, isConsoleLocale } from "./i18n.ts";

describe("console catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isConsoleLocale("pt-BR")).toBe(true);
		expect(isConsoleLocale("es")).toBe(true);
		expect(isConsoleLocale("fr")).toBe(false);
		expect(consoleMessages("fr")).toBe(consoleMessages(BASE_LOCALE));
		expect(consoleMessages("pt-BR").badge).toBe("PLATAFORMA");
		expect(consoleMessages("es").signOut).toBe("Cerrar sesión");
	});

	it("has no blank copy in any locale", () => {
		const leaves = (node: unknown): string[] =>
			typeof node === "string"
				? [node]
				: node && typeof node === "object"
					? Object.values(node).flatMap(leaves)
					: [];
		for (const locale of CONSOLE_LOCALES) {
			expect(leaves(consoleMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});
});
