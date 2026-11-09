import { describe, expect, it } from "vitest";

import type { Plugin } from "@ktb/kernel";

import { platformHeaderPlugin, plugins } from "./index.ts";

describe("platform-header plugin", () => {
	it("exports the marker plugin ordered after platform.panel", () => {
		expect(plugins).toEqual([platformHeaderPlugin]);
		expect(platformHeaderPlugin.id).toBe("platform.header");
		expect(platformHeaderPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect((platformHeaderPlugin as Plugin).panel).toBeUndefined();
	});
});
