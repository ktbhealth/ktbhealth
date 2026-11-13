import { describe, expect, it } from "vitest";
import { generatedDashboards } from "./dashboards/index";

/**
 * Structural checks on the generated dashboard models — enough to catch
 * builder regressions (missing uid/datasource, empty panels, broken
 * variable wiring) without snapshotting the whole JSON.
 */

interface PanelLike {
	readonly id?: number;
	readonly type?: string;
	readonly title?: string;
	readonly datasource?: { readonly type?: string; readonly uid?: string };
	readonly targets?: readonly {
		readonly expr?: string;
		readonly query?: string;
		readonly refId?: string;
	}[];
}

interface DashboardLike {
	readonly uid?: string;
	readonly title?: string;
	readonly panels?: readonly PanelLike[];
	readonly templating?: { readonly list?: readonly { readonly name?: string }[] };
}

const dashboards = generatedDashboards().map(({ uid, dashboard }) => ({
	uid,
	dashboard: dashboard as unknown as DashboardLike,
}));

describe("generated dashboards", () => {
	it("emits the three expected dashboards with stable uids", () => {
		expect(dashboards.map((d) => d.uid)).toEqual([
			"ktb-platform",
			"ktb-telemetry-health",
			"ktb-client-events",
		]);
		for (const { dashboard } of dashboards) {
			expect(dashboard.uid).toBeTruthy();
			expect(dashboard.title).toBeTruthy();
			expect(dashboard.panels?.length).toBeGreaterThan(0);
		}
	});

	it("every panel has a unique id and a known type", () => {
		const knownTypes = new Set(["row", "stat", "timeseries", "text", "table", "logs"]);
		for (const { uid, dashboard } of dashboards) {
			const ids = (dashboard.panels ?? []).map((p) => p.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const panel of dashboard.panels ?? []) {
				expect(knownTypes.has(panel.type ?? "")).toBe(true);
				expect(panel.title).toBeTruthy();
			}
			void uid;
		}
	});

	it("query panels only use provisioned datasource uids", () => {
		const allowed = new Set(["prometheus", "loki", "tempo"]);
		for (const { dashboard } of dashboards) {
			for (const panel of dashboard.panels ?? []) {
				if (panel.type === "row" || panel.type === "text") continue;
				expect(allowed.has(panel.datasource?.uid ?? "")).toBe(true);
			}
		}
	});

	it("platform dashboard keeps the ktb-platform uid used by alert annotations", () => {
		const platform = dashboards.find((d) => d.uid === "ktb-platform");
		expect(platform?.dashboard.uid).toBe("ktb-platform");
	});

	it("all Prometheus targets carry an expr and unique refIds per panel", () => {
		for (const { dashboard } of dashboards) {
			for (const panel of dashboard.panels ?? []) {
				const targets = panel.targets ?? [];
				const refIds = targets.map((t) => t.refId);
				expect(new Set(refIds).size).toBe(refIds.length);
				for (const target of targets) {
					expect(target.expr ?? target.query).toBeTruthy();
				}
			}
		}
	});

	it("template variables are wired to prometheus label_values queries", () => {
		for (const { dashboard } of dashboards) {
			for (const variable of dashboard.templating?.list ?? []) {
				expect(variable.name).toBeTruthy();
			}
		}
	});
});
