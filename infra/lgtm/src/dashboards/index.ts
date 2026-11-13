import type { Dashboard } from "@grafana/grafana-foundation-sdk/dashboard";
import { clientEventsDashboard } from "./client-events";
import { platformDashboard } from "./platform";
import { telemetryHealthDashboard } from "./telemetry-health";

/**
 * All provisioned dashboards, as built JSON models. `gen-dashboards.ts`
 * writes each to provisioning/dashboards/<uid>.json; the file provider
 * (provisioning/dashboards/provider.yaml) picks them up on its 30s
 * updateIntervalSeconds.
 */
export interface GeneratedDashboard {
	readonly uid: string;
	readonly dashboard: Dashboard;
}

export const generatedDashboards = (): GeneratedDashboard[] => [
	{ uid: "ktb-platform", dashboard: platformDashboard().build() },
	{ uid: "ktb-telemetry-health", dashboard: telemetryHealthDashboard().build() },
	{ uid: "ktb-client-events", dashboard: clientEventsDashboard().build() },
];
