import { describe, expect, it } from "vitest";

import {
	BASE_LOCALE,
	DASHBOARD_LOCALES,
	dashboardMessages,
	isDashboardLocale,
} from "./i18n.ts";

describe("dashboard catalogs", () => {
	it("resolves known locales and falls back to the base locale", () => {
		expect(isDashboardLocale("pt-BR")).toBe(true);
		expect(isDashboardLocale("es")).toBe(true);
		expect(isDashboardLocale("fr")).toBe(false);
		expect(dashboardMessages("fr")).toBe(dashboardMessages(BASE_LOCALE));
		expect(dashboardMessages("pt-BR").title).toBe("painel");
		expect(dashboardMessages("es").title).toBe("panel");
	});

	it("has no blank copy in any locale", () => {
		const leaves = (node: unknown): string[] =>
			typeof node === "string"
				? [node]
				: node && typeof node === "object"
					? Object.values(node).flatMap(leaves)
					: [];
		for (const locale of DASHBOARD_LOCALES) {
			expect(leaves(dashboardMessages(locale)).every((s) => s.trim() !== "")).toBe(true);
		}
	});
});
