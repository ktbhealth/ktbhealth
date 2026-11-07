import { describe, expect, it } from "vitest";

import { makeStubVerifier, STUB_CAPTCHA_TOKEN } from "./index.ts";

describe("stub captcha verifier", () => {
	it("accepts absent and stub tokens, rejects others", async () => {
		const v = makeStubVerifier();
		expect(await v.verify(undefined)).toBe(true);
		expect(await v.verify("")).toBe(true);
		expect(await v.verify(STUB_CAPTCHA_TOKEN)).toBe(true);
		expect(await v.verify("real-looking-token")).toBe(false);
	});
});
