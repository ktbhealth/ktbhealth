import { describe, expect, it } from "vitest";

import type { Plugin } from "@ktb/kernel";

import { platformSidebarPlugin, plugins } from "./index.ts";

describe("platform-sidebar plugin", () => {
	it("exports the marker plugin ordered after platform.panel", () => {
		expect(plugins).toEqual([platformSidebarPlugin]);
		expect(platformSidebarPlugin.id).toBe("platform.sidebar");
		expect(platformSidebarPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect((platformSidebarPlugin as Plugin).panel).toBeUndefined();
	});
});
