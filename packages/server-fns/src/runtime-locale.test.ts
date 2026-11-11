import { afterEach, describe, expect, it } from "vitest";

import { getLocale, resetServerRuntime, setServerRuntime } from "./index.ts";

afterEach(() => resetServerRuntime());

describe("getLocale", () => {
	it("reads the active locale from the registered runtime", () => {
		setServerRuntime({
			run: () => Promise.reject(new Error("unused")),
			runAs: () => Promise.reject(new Error("unused")),
			getLocale: () => "pt-BR",
			audioTranscribeModel: "test-model",
		});
		expect(getLocale()).toBe("pt-BR");
	});

	it("throws when no runtime is registered", () => {
		expect(() => getLocale()).toThrow("runtime not initialized");
	});
});
