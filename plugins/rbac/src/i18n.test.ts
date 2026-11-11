import { describe, expect, it } from "vitest";

import { BASE_LOCALE, isRbacLocale, RBAC_LOCALES, rbacMessages } from "./i18n.ts";

describe("rbac i18n", () => {
	it("every locale catalog implements the full message shape", () => {
		for (const locale of RBAC_LOCALES) {
			const m = rbacMessages(locale);
			expect(m.title.length).toBeGreaterThan(0);
			expect(m.effectAllow).toBeTruthy();
			expect(m.effectDeny).toBeTruthy();
		}
	});

	it("falls back to the base locale for unknown tags", () => {
		expect(isRbacLocale("en")).toBe(true);
		expect(isRbacLocale("pt-BR")).toBe(true);
		expect(isRbacLocale("es")).toBe(true);
		expect(isRbacLocale("fr")).toBe(false);
		expect(rbacMessages("fr")).toBe(rbacMessages(BASE_LOCALE));
		expect(rbacMessages("pt-BR").title).not.toBe(rbacMessages("en").title);
	});
});
