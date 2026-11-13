import {
	DashboardBuilder,
	DashboardCursorSync,
	DashboardLinkBuilder,
	DashboardLinkType,
	QueryVariableBuilder,
	RowBuilder,
	ThresholdsConfigBuilder,
	ThresholdsMode,
	VariableRefresh,
	VariableSort,
} from "@grafana/grafana-foundation-sdk/dashboard";
import {
	BigValueColorMode,
	BigValueGraphMode,
	LogsSortOrder,
} from "@grafana/grafana-foundation-sdk/common";
import { PanelBuilder as LogsPanelBuilder } from "@grafana/grafana-foundation-sdk/logs";
import { PanelBuilder as StatPanelBuilder } from "@grafana/grafana-foundation-sdk/stat";
import { PanelBuilder as TablePanelBuilder } from "@grafana/grafana-foundation-sdk/table";
import { PanelBuilder as TimeseriesPanelBuilder } from "@grafana/grafana-foundation-sdk/timeseries";
import {
	DS_LOKI,
	DS_PROMETHEUS,
	grid,
	lastNotNull,
	loki,
	prom,
	promInstant,
	timeseriesStyle,
} from "./shared";

/**
 * "KTB Platform — Client Telemetry": browser-side observability.
 *
 * The client SDK (packages/observability/src/client.ts) batches events to
 * /api/telemetry; the server counts them on ktb_client_events_total and
 * re-emits each as a `client.*` log record (visible in Loki). There is no
 * client duration histogram — the interesting client signals are volume,
 * type mix, and why events get dropped before ingest.
 */
export const clientEventsDashboard = () =>
	new DashboardBuilder("KTB Platform — Client Telemetry")
		.uid("ktb-client-events")
		.description(
			"Browser telemetry: events ingested at /api/telemetry (ktb_client_events_total), rejections (ktb_client_events_dropped_total) and the resulting client.* log records in Loki. Complements the Telemetry health dashboard with type/reason drill-downs.",
		)
		.tags(["ktb", "client", "telemetry"])
		.timezone("browser")
		.time({ from: "now-24h", to: "now" })
		.refresh("1m")
		.version(1)
		.readonly()
		.tooltip(DashboardCursorSync.Crosshair)
		.withVariable(
			new QueryVariableBuilder("type")
				.label("Event type")
				.description(
					"Event type on ktb_client_events_total (event | error | navigation | request).",
				)
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_client_events_total, type)")
				.refresh(VariableRefresh.OnDashboardLoad)
				.sort(VariableSort.AlphabeticalAsc)
				.multi(true)
				.includeAll(true)
				.allValue(".*"),
		)
		.withVariable(
			new QueryVariableBuilder("reason")
				.label("Drop reason")
				.description(
					"Drop reason on ktb_client_events_dropped_total (disabled | invalid | rate_limited | oversized | sampled).",
				)
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_client_events_dropped_total, reason)")
				.refresh(VariableRefresh.OnDashboardLoad)
				.sort(VariableSort.AlphabeticalAsc)
				.multi(true)
				.includeAll(true)
				.allValue(".*"),
		)
		.link(
			new DashboardLinkBuilder("Telemetry health")
				.type(DashboardLinkType.Link)
				.url("/d/ktb-telemetry-health")
				.includeVars(true)
				.keepTime(true),
		)
		.link(
			new DashboardLinkBuilder("RED/USE")
				.type(DashboardLinkType.Link)
				.url("/d/ktb-platform")
				.includeVars(true)
				.keepTime(true),
		)
		// ---- Row: Overview ---------------------------------------------------
		.withRow(
			new RowBuilder("Overview")
				.id(1)
				.gridPos(grid(0, 0, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(2)
				.title("Client events ingested (1h)")
				.description(
					"ktb_client_events_total increase over the last hour — browser telemetry accepted at /api/telemetry.",
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(0, 1, 8, 4))
				.unit("short")
				.decimals(0)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.withTarget(prom("A", "sum(increase(ktb_client_events_total[1h]))")),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(3)
				.title("Client events dropped (1h)")
				.description(
					"ktb_client_events_dropped_total increase over the last hour — events rejected before ingest (disabled | invalid | rate_limited | oversized | sampled).",
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(8, 1, 8, 4))
				.unit("short")
				.decimals(0)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.thresholds(
					new ThresholdsConfigBuilder().mode(ThresholdsMode.Absolute).steps([
						{ color: "green", value: null },
						{ color: "yellow", value: 50 },
						{ color: "red", value: 500 },
					]),
				)
				.withTarget(prom("A", "sum(increase(ktb_client_events_dropped_total[1h]))")),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(4)
				.title("Drop ratio (1h)")
				.description(
					"dropped / (ingested + dropped) over the last hour. Sustained >5% suggests client payloads failing validation or the ingest rate cap being hit.",
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(16, 1, 8, 4))
				.unit("percentunit")
				.decimals(2)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.None)
				.reduceOptions(lastNotNull())
				.thresholds(
					new ThresholdsConfigBuilder().mode(ThresholdsMode.Absolute).steps([
						{ color: "green", value: null },
						{ color: "yellow", value: 0.01 },
						{ color: "red", value: 0.05 },
					]),
				)
				.withTarget(
					prom(
						"A",
						"sum(increase(ktb_client_events_dropped_total[1h])) / (sum(increase(ktb_client_events_total[1h])) + sum(increase(ktb_client_events_dropped_total[1h])))",
					),
				),
		)
		// ---- Row: Rates -------------------------------------------------------
		.withRow(
			new RowBuilder("Rates")
				.id(5)
				.gridPos(grid(0, 5, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(6)
					.title("Client events ingested by type")
					.description(
						"ktb_client_events_total rate per event type: event (custom domain events), error (window errors/unhandled rejections), navigation (route changes), request (fetch/XHR instrumentation).",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 6, 12, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							'sum by (type) (rate(ktb_client_events_total{type=~"$type"}[$__rate_interval]))',
							"{{type}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(7)
					.title("Client events dropped by reason")
					.description(
						"ktb_client_events_dropped_total rate per reason. 'disabled' dominating means KTB_TELEMETRY_CLIENT is unset in the client env — check deployment config before treating as an incident.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 6, 12, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							'sum by (reason) (rate(ktb_client_events_dropped_total{reason=~"$reason"}[$__rate_interval]))',
							"{{reason}}",
						),
					),
			),
		)
		// ---- Row: Totals --------------------------------------------------------
		.withRow(
			new RowBuilder("Totals in range")
				.id(8)
				.gridPos(grid(0, 14, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			new TablePanelBuilder()
				.id(9)
				.title("Events by type (selected range)")
				.description("increase() over the dashboard time range, grouped by event type.")
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(0, 15, 12, 8))
				.withTarget(
					promInstant(
						"A",
						'sum by (type) (increase(ktb_client_events_total{type=~"$type"}[$__range]))',
					),
				),
		)
		.withPanel(
			new TablePanelBuilder()
				.id(10)
				.title("Drops by reason (selected range)")
				.description("increase() over the dashboard time range, grouped by drop reason.")
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(12, 15, 12, 8))
				.withTarget(
					promInstant(
						"A",
						'sum by (reason) (increase(ktb_client_events_dropped_total{reason=~"$reason"}[$__range]))',
					),
				),
		)
		// ---- Row: Log records ----------------------------------------------------
		.withRow(
			new RowBuilder("Log records (Loki)")
				.id(11)
				.gridPos(grid(0, 23, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			new LogsPanelBuilder()
				.id(12)
				.title("client.* log records")
				.description(
					"Every ingested client event is re-emitted as a client.<type> log record with annotations (type, name, path, status, durationMs, event.message). Errors log at Error level — also match client.error.stack debug lines when expanded.",
				)
				.datasource(DS_LOKI)
				.gridPos(grid(0, 24, 24, 10))
				.showTime(true)
				.wrapLogMessage(true)
				.sortOrder(LogsSortOrder.Descending)
				.withTarget(loki("A", '{service_name="ktb"} |~ "client\\."')),
		);
