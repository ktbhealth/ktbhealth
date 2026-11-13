import { describe, expect, it } from "vitest";

import { timingSafeEqual } from "./timing-safe.ts";

describe("timingSafeEqual", () => {
	it("returns true for identical strings", async () => {
		await expect(timingSafeEqual("Bearer scrape-secret", "Bearer scrape-secret")).resolves.toBe(
			true,
		);
		await expect(timingSafeEqual("", "")).resolves.toBe(true);
	});

	it("returns false for different strings, including length mismatches", async () => {
		await expect(timingSafeEqual("Bearer wrong", "Bearer scrape-secret")).resolves.toBe(false);
		await expect(
			timingSafeEqual("Bearer scrape-secret-extra", "Bearer scrape-secret"),
		).resolves.toBe(false);
		await expect(timingSafeEqual("", "x")).resolves.toBe(false);
	});
});
