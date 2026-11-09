import { describe, expect, it } from "vitest";

import { PATIENT_LOCALES } from "@ktb/patients/i18n";
import { locales } from "#/paraglide/runtime.js";

import {
	changeLocale,
	localeFromCookieHeader,
	localeName,
	pluginNavLabel,
	requestLocale,
} from "./i18n.ts";

describe("localeFromCookieHeader", () => {
	it("returns undefined for a missing header", () => {
		expect(localeFromCookieHeader(null)).toBeUndefined();
	});

	it("returns undefined when the cookie is absent", () => {
		expect(localeFromCookieHeader("session=abc; theme=dark")).toBeUndefined();
	});

	it("extracts a known locale", () => {
		expect(localeFromCookieHeader("ktb-locale=pt-BR")).toBe("pt-BR");
	});

	it("extracts the locale when it is not the first cookie", () => {
		expect(localeFromCookieHeader("a=1; ktb-locale=en; b=2")).toBe("en");
	});

	it("returns undefined for an unknown locale value", () => {
		expect(localeFromCookieHeader("ktb-locale=fr")).toBeUndefined();
	});
});

describe("requestLocale", () => {
	it("prefers the locale cookie", () => {
		const req = new Request("http://localhost/", {
			headers: { cookie: "ktb-locale=pt-BR" },
		});
		expect(requestLocale(req)).toBe("pt-BR");
	});

	it("falls back to the base locale without a cookie", () => {
		expect(requestLocale(new Request("http://localhost/"))).toBe("en");
	});
});

describe("localeName", () => {
	it("returns the endonym for known locales", () => {
		expect(localeName("en")).toBe("English");
		expect(localeName("pt-BR")).toBe("Português (Brasil)");
	});

	it("falls back to the raw tag for unknown locales", () => {
		expect(localeName("fr")).toBe("fr");
	});
});

describe("changeLocale", () => {
	it("sets a known locale", () => {
		expect(() => changeLocale("pt-BR")).not.toThrow();
	});

	it("ignores unknown locales", () => {
		expect(() => changeLocale("fr")).not.toThrow();
	});
});

describe("pluginNavLabel", () => {
	it("localizes known plugin destinations", () => {
		expect(pluginNavLabel("/consultations", "Consultations")).toBe("Consultations");
		expect(pluginNavLabel("/patients", "Patients")).toBe("Patients");
	});

	it("falls back to the plugin-provided label", () => {
		expect(pluginNavLabel("/other", "Other")).toBe("Other");
	});
});

describe("plugin catalogs", () => {
	// Plugins ship their own copy (they cannot import paraglide output);
	// adding an app locale must come with a catalog in each plugin.
	it("patients covers every app locale", () => {
		expect([...PATIENT_LOCALES].sort()).toEqual([...locales].sort());
	});
});
