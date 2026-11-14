import { afterEach, describe, expect, it } from "vitest";

import { overwriteGetLocale } from "#/paraglide/runtime.js";

import { verificationEmail } from "./emails.ts";

const url = "http://localhost:3000/api/auth/verify-email?token=t";

afterEach(() => overwriteGetLocale(() => "en"));

describe("verificationEmail", () => {
	it("greets by name and carries the link", () => {
		overwriteGetLocale(() => "en");
		const mail = verificationEmail({ name: "Ana", url });
		expect(mail.subject).toBe("Confirm your email — KTB Health");
		expect(mail.text.split("\n")).toEqual([
			"Hello, Ana.",
			"",
			"Confirm your email address to finish setting up your KTB Health account:",
			url,
			"",
			"If you did not create this account, you can ignore this message.",
		]);
	});

	it("falls back to an anonymous greeting", () => {
		overwriteGetLocale(() => "en");
		expect(verificationEmail({ name: null, url }).text).toMatch(/^Hello\.\n/);
	});

	it("follows the current request locale", () => {
		overwriteGetLocale(() => "pt-BR");
		const pt = verificationEmail({ name: "Ana", url });
		expect(pt.subject).toBe("Confirme seu e-mail — KTB Health");
		expect(pt.text).toContain("Olá, Ana.");
		overwriteGetLocale(() => "es");
		expect(verificationEmail({ name: "Ana", url }).text).toContain("Hola, Ana.");
	});
});
