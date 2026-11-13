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
import { BigValueColorMode, BigValueGraphMode } from "@grafana/grafana-foundation-sdk/common";
import { PanelBuilder as StatPanelBuilder } from "@grafana/grafana-foundation-sdk/stat";
import { PanelBuilder as TimeseriesPanelBuilder } from "@grafana/grafana-foundation-sdk/timeseries";
import {
	DS_PROMETHEUS,
	EXPLORE_LOGS_URL,
	EXPLORE_TRACES_URL,
	grid,
	lastNotNull,
	prom,
	timeseriesStyle,
} from "./shared";

/**
 * "KTB Platform — RED/USE": the request-path dashboard.
 *
 * Rate / Errors / Duration come from the app-side `ktb_*` metrics
 * (packages/observability/src/metrics.ts) pushed over OTLP and stored in
 * Prometheus. Saturation signals (client-event drops, telemetry pipeline
 * errors) are included because a Workers app has no local queue to fill —
 * drops at the telemetry edge ARE the saturation signal.
 *
 * uid stays `ktb-platform` so the alert annotations in
 * provisioning/alerting/alerting.yaml (`dashboard: "/d/ktb-platform"`)
 * keep resolving.
 */
export const platformDashboard = () =>
	new DashboardBuilder("KTB Platform — RED/USE")
		.uid("ktb-platform")
		.description(
			"RED/USE signals for the KTB Workers app: HTTP edge, app runtime, CQRS dispatch and telemetry-edge saturation. Metrics are generated app-side (effect/Metric → OTLP → Prometheus) and are NOT affected by trace tail sampling.",
		)
		.tags(["ktb", "platform", "red"])
		.timezone("browser")
		.time({ from: "now-6h", to: "now" })
		.refresh("30s")
		.version(1)
		.readonly()
		.tooltip(DashboardCursorSync.Crosshair)
		.withVariable(
			new QueryVariableBuilder("handlerType")
				.label("Handler type")
				.description("HTTP handler kind recorded on ktb_http_requests_total (serverFn | router).")
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_http_requests_total, handlerType)")
				.refresh(VariableRefresh.OnDashboardLoad)
				.sort(VariableSort.AlphabeticalAsc)
				.multi(true)
				.includeAll(true)
				.allValue(".*"),
		)
		.withVariable(
			new QueryVariableBuilder("side")
				.label("CQRS side")
				.description("Dispatch side recorded on ktb_cqrs_* metrics (command | query).")
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_cqrs_dispatches_total, side)")
				.refresh(VariableRefresh.OnDashboardLoad)
				.sort(VariableSort.AlphabeticalAsc)
				.multi(true)
				.includeAll(true)
				.allValue(".*"),
		)
		// ---- Header links -------------------------------------------------
		.link(
			new DashboardLinkBuilder("Traces (Tempo)")
				.type(DashboardLinkType.Link)
				.url(EXPLORE_TRACES_URL)
				.icon("external link")
				.targetBlank(true),
		)
		.link(
			new DashboardLinkBuilder("Logs (Loki)")
				.type(DashboardLinkType.Link)
				.url(EXPLORE_LOGS_URL)
				.icon("external link")
				.targetBlank(true),
		)
		.link(
			new DashboardLinkBuilder("Telemetry health")
				.type(DashboardLinkType.Link)
				.url("/d/ktb-telemetry-health")
				.includeVars(true)
				.keepTime(true),
		)
		.link(
			new DashboardLinkBuilder("Client telemetry")
				.type(DashboardLinkType.Link)
				.url("/d/ktb-client-events")
				.includeVars(true)
				.keepTime(true),
		)
		// ---- Row: HTTP edge (RED) ----------------------------------------
		.withRow(
			new RowBuilder("HTTP edge (RED)")
				.id(1)
				.gridPos(grid(0, 0, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(2)
				.title("Request rate")
				.description("HTTP requests per second across all handler types (ktb_http_requests_total).")
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(0, 1, 6, 4))
				.unit("reqps")
				.decimals(2)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.withTarget(
					prom(
						"A",
						'sum(rate(ktb_http_requests_total{handlerType=~"$handlerType"}[$__rate_interval]))',
						"req/s",
					),
				),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(3)
				.title("5xx ratio")
				.description(
					"Share of responses with status 5xx over 5m. Alert threshold: >5% for 10m (ktb-http-5xx-ratio).",
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(6, 1, 6, 4))
				.unit("percentunit")
				.decimals(2)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
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
						'sum(rate(ktb_http_requests_total{handlerType=~"$handlerType",status=~"5.."}[5m])) / sum(rate(ktb_http_requests_total{handlerType=~"$handlerType"}[5m]))',
					),
				),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(4)
				.title("p95 latency")
				.description(
					"HTTP p95 wall time in ms (histogram_quantile over ktb_http_request_duration_ms). Alert threshold: >2s for 15m.",
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(12, 1, 6, 4))
				.unit("ms")
				.decimals(0)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.thresholds(
					new ThresholdsConfigBuilder().mode(ThresholdsMode.Absolute).steps([
						{ color: "green", value: null },
						{ color: "yellow", value: 500 },
						{ color: "red", value: 2000 },
					]),
				)
				.withTarget(
					prom(
						"A",
						'histogram_quantile(0.95, sum by (le) (rate(ktb_http_request_duration_ms_bucket{handlerType=~"$handlerType"}[5m])))',
					),
				),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(5)
				.title("Error ratio (4xx + 5xx)")
				.description(
					"Share of non-2xx responses. Client errors (4xx) included — watch for scanner noise vs real regressions.",
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(18, 1, 6, 4))
				.unit("percentunit")
				.decimals(2)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.None)
				.reduceOptions(lastNotNull())
				.thresholds(
					new ThresholdsConfigBuilder().mode(ThresholdsMode.Absolute).steps([
						{ color: "green", value: null },
						{ color: "yellow", value: 0.05 },
						{ color: "red", value: 0.2 },
					]),
				)
				.withTarget(
					prom(
						"A",
						'sum(rate(ktb_http_requests_total{handlerType=~"$handlerType",status=~"[45].."}[5m])) / sum(rate(ktb_http_requests_total{handlerType=~"$handlerType"}[5m]))',
					),
				),
		)
		// ---- HTTP timeseries ----------------------------------------------
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(6)
					.title("Request rate by handler type")
					.description(
						"ktb_http_requests_total rate split by handlerType (serverFn vs router page loads).",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 5, 12, 8))
					.unit("reqps")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							'sum by (handlerType) (rate(ktb_http_requests_total{handlerType=~"$handlerType"}[$__rate_interval]))',
							"{{handlerType}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(7)
					.title("5xx ratio by handler type")
					.description(
						"5xx share per handlerType over the rate interval. A spike isolated to one handler type points at that code path, not the edge.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 5, 12, 8))
					.unit("percentunit")
					.decimals(2)
					.max(1)
					.withTarget(
						prom(
							"A",
							'sum by (handlerType) (rate(ktb_http_requests_total{handlerType=~"$handlerType",status=~"5.."}[$__rate_interval])) / sum by (handlerType) (rate(ktb_http_requests_total{handlerType=~"$handlerType"}[$__rate_interval]))',
							"{{handlerType}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(8)
					.title("Latency quantiles (p50 / p95 / p99)")
					.description(
						"histogram_quantile over ktb_http_request_duration_ms buckets. p99 is tail-sensitive on low traffic — read it with p50/p95.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 13, 12, 8))
					.unit("ms")
					.decimals(0)
					.withTarget(
						prom(
							"A",
							'histogram_quantile(0.50, sum by (le) (rate(ktb_http_request_duration_ms_bucket{handlerType=~"$handlerType"}[$__rate_interval])))',
							"p50",
						),
					)
					.withTarget(
						prom(
							"B",
							'histogram_quantile(0.95, sum by (le) (rate(ktb_http_request_duration_ms_bucket{handlerType=~"$handlerType"}[$__rate_interval])))',
							"p95",
						),
					)
					.withTarget(
						prom(
							"C",
							'histogram_quantile(0.99, sum by (le) (rate(ktb_http_request_duration_ms_bucket{handlerType=~"$handlerType"}[$__rate_interval])))',
							"p99",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(9)
					.title("Latency p95 by handler type")
					.description(
						"p95 per handlerType — separates slow server functions from slow page/router loads.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 13, 12, 8))
					.unit("ms")
					.decimals(0)
					.withTarget(
						prom(
							"A",
							'histogram_quantile(0.95, sum by (le, handlerType) (rate(ktb_http_request_duration_ms_bucket{handlerType=~"$handlerType"}[$__rate_interval])))',
							"{{handlerType}}",
						),
					),
			),
		)
		// ---- Row: App runtime & CQRS --------------------------------------
		.withRow(
			new RowBuilder("App runtime & CQRS")
				.id(10)
				.gridPos(grid(0, 21, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(11)
					.title("App invocations by kind")
					.description(
						"ktb_app_invocations_total — Effect programs run through the app runtime, split by kind (run / runAs / …).",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 22, 8, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							"sum by (kind) (rate(ktb_app_invocations_total[$__rate_interval]))",
							"{{kind}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(12)
					.title("App invocation duration quantiles")
					.description(
						"p50/p95/p99 wall time of app runtime invocations (ktb_app_invocation_duration_ms).",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(8, 22, 8, 8))
					.unit("ms")
					.decimals(0)
					.withTarget(
						prom(
							"A",
							"histogram_quantile(0.50, sum by (le) (rate(ktb_app_invocation_duration_ms_bucket[$__rate_interval])))",
							"p50",
						),
					)
					.withTarget(
						prom(
							"B",
							"histogram_quantile(0.95, sum by (le) (rate(ktb_app_invocation_duration_ms_bucket[$__rate_interval])))",
							"p95",
						),
					)
					.withTarget(
						prom(
							"C",
							"histogram_quantile(0.99, sum by (le) (rate(ktb_app_invocation_duration_ms_bucket[$__rate_interval])))",
							"p99",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(13)
					.title("CQRS dispatch rate by side")
					.description(
						"ktb_cqrs_dispatches_total — command vs query dispatches through the shared bus middleware.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(16, 22, 8, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							'sum by (side) (rate(ktb_cqrs_dispatches_total{side=~"$side"}[$__rate_interval]))',
							"{{side}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(14)
					.title("CQRS failure ratio by side")
					.description(
						"ktb_cqrs_dispatch_failures_total / ktb_cqrs_dispatches_total per side. Failures here are Effect failures, not HTTP 5xx — a handler may still map them to 4xx.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 30, 12, 8))
					.unit("percentunit")
					.decimals(2)
					.max(1)
					.withTarget(
						prom(
							"A",
							'sum by (side) (rate(ktb_cqrs_dispatch_failures_total{side=~"$side"}[$__rate_interval])) / sum by (side) (rate(ktb_cqrs_dispatches_total{side=~"$side"}[$__rate_interval]))',
							"{{side}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(15)
					.title("CQRS dispatch duration p95 by side")
					.description(
						"p95 dispatch wall time per side (ktb_cqrs_dispatch_duration_ms). Slow queries usually dominate this panel.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 30, 12, 8))
					.unit("ms")
					.decimals(0)
					.withTarget(
						prom(
							"A",
							'histogram_quantile(0.95, sum by (le, side) (rate(ktb_cqrs_dispatch_duration_ms_bucket{side=~"$side"}[$__rate_interval])))',
							"{{side}}",
						),
					),
			),
		)
		// ---- Row: Saturation (telemetry edge) ------------------------------
		.withRow(
			new RowBuilder("Saturation (telemetry edge)")
				.id(16)
				.gridPos(grid(0, 38, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(17)
					.title("Client events dropped by reason")
					.description(
						"ktb_client_events_dropped_total — browser telemetry rejected at ingest. reason: disabled | invalid | rate_limited | oversized | sampled. 'disabled' means KTB_TELEMETRY_CLIENT is off, not a bug.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 39, 12, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							"sum by (reason) (rate(ktb_client_events_dropped_total[$__rate_interval]))",
							"{{reason}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(18)
					.title("Telemetry pipeline errors by stage")
					.description(
						"ktb_telemetry_errors_total — stage: ingest | export | flush. Export errors mean telemetry is being lost between the Worker and this collector; see the Telemetry health dashboard.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 39, 12, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							"sum by (stage) (rate(ktb_telemetry_errors_total[$__rate_interval]))",
							"{{stage}}",
						),
					),
			),
		);
