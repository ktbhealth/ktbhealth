import { describe, expect, it } from "vitest";
import { LayoutDashboardIcon } from "lucide-react";

import { platformPanelPlugin } from "@ktb/platform";
import type { Plugin } from "@ktb/kernel";

import { dashboardPanelPlugin, plugins } from "./index.ts";

describe("dashboardPanelPlugin", () => {
	it("declares the ungrouped /platform sidebar entry", () => {
		expect(dashboardPanelPlugin.id).toBe("dashboard.panel");
		expect(dashboardPanelPlugin.requiredDeps).toEqual([platformPanelPlugin.id]);
		expect(dashboardPanelPlugin.panel?.sidebar).toEqual([
			{
				to: "/platform",
				label: "Dashboard",
				icon: LayoutDashboardIcon,
				exact: true,
			},
		]);
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["dashboard.panel"]);
		const p: Plugin = dashboardPanelPlugin;
		expect("panel" in p && p.panel.sidebar?.[0]?.group).toBeUndefined();
	});
});
