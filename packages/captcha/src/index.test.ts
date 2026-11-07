import { describe, expect, it } from "vitest";

import type { CaptchaVerifier } from "./index.ts";

describe("captcha port", () => {
	it("is satisfied by a fail-closed implementation", async () => {
		const v: CaptchaVerifier = { verify: async () => false };
		expect(await v.verify("x")).toBe(false);
	});
});
