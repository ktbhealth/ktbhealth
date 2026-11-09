import { describe, expect, it } from "vitest";
import { LayoutDashboardIcon } from "lucide-react";

import { platformPanelPlugin } from "@ktb/platform";
import type { Plugin } from "@ktb/kernel";

import { dashboardPanelPlugin, plugins } from "./index.ts";

describe("dashboardPanelPlugin", () => {
	it("declares the /platform sidebar entry in the General group", () => {
		expect(dashboardPanelPlugin.id).toBe("dashboard.panel");
		expect(dashboardPanelPlugin.requiredDeps).toEqual([platformPanelPlugin.id]);
		expect(dashboardPanelPlugin.panel?.sidebar).toEqual([
			{
				to: "/platform",
				label: "Dashboard",
				icon: LayoutDashboardIcon,
				exact: true,
				group: "General",
			},
		]);
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["dashboard.panel"]);
		const p: Plugin = dashboardPanelPlugin;
		expect(p.panel?.sidebar?.[0]?.group).toBe("General");
	});
});
