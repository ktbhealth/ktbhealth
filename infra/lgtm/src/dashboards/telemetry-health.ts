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
import { PanelBuilder as TextPanelBuilder, TextMode } from "@grafana/grafana-foundation-sdk/text";
import { PanelBuilder as TimeseriesPanelBuilder } from "@grafana/grafana-foundation-sdk/timeseries";
import {
	DS_LOKI,
	DS_PROMETHEUS,
	DS_TEMPO,
	EXPLORE_LOGS_URL,
	EXPLORE_TRACES_URL,
	grid,
	lastNotNull,
	loki,
	prom,
	tempoSearch,
	timeseriesStyle,
} from "./shared";

/**
 * "KTB Platform — Telemetry Health": is the observability pipeline itself
 * healthy? Covers the three failure modes that are invisible on the RED
 * dashboard:
 *
 *  - OTLP export failures app-side (ktb_telemetry_errors_total stage=export)
 *  - client-event ingest drops / rejections
 *  - collector/storage silence (dead-man signal lives in alerting.yaml —
 *    this dashboard shows the surrounding context)
 *
 * Also surfaces Loki log volume and a live Tempo error-trace table so the
 * "are traces actually arriving?" question is answered in one place.
 */
export const telemetryHealthDashboard = () =>
	new DashboardBuilder("KTB Platform — Telemetry Health")
		.uid("ktb-telemetry-health")
		.description(
			"Health of the telemetry pipeline itself: OTLP export errors, client-event ingest/drops, Loki log volume and Tempo trace arrival. Complements the RED/USE dashboard — a green app with a dead pipeline still pages via the ktb-telemetry-absent dead-man alert.",
		)
		.tags(["ktb", "telemetry", "pipeline"])
		.timezone("browser")
		.time({ from: "now-24h", to: "now" })
		.refresh("1m")
		.version(1)
		.readonly()
		.tooltip(DashboardCursorSync.Crosshair)
		.withVariable(
			new QueryVariableBuilder("stage")
				.label("Error stage")
				.description("Bounded stage label on ktb_telemetry_errors_total (ingest | export | flush).")
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_telemetry_errors_total, stage)")
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
					"Bounded reason label on ktb_client_events_dropped_total (disabled | invalid | rate_limited | oversized | sampled).",
				)
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_client_events_dropped_total, reason)")
				.refresh(VariableRefresh.OnDashboardLoad)
				.sort(VariableSort.AlphabeticalAsc)
				.multi(true)
				.includeAll(true)
				.allValue(".*"),
		)
		.withVariable(
			new QueryVariableBuilder("type")
				.label("Event type")
				.description(
					"Event type recorded on ktb_client_events_total (event | error | navigation | request).",
				)
				.datasource(DS_PROMETHEUS)
				.query("label_values(ktb_client_events_total, type)")
				.refresh(VariableRefresh.OnDashboardLoad)
				.sort(VariableSort.AlphabeticalAsc)
				.multi(true)
				.includeAll(true)
				.allValue(".*"),
		)
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
			new DashboardLinkBuilder("RED/USE")
				.type(DashboardLinkType.Link)
				.url("/d/ktb-platform")
				.includeVars(true)
				.keepTime(true),
		)
		// ---- Row: Pipeline self-observability ------------------------------
		.withRow(
			new RowBuilder("Pipeline self-observability")
				.id(1)
				.gridPos(grid(0, 0, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(2)
				.title("OTLP export errors (15m)")
				.description(
					'ktb_telemetry_errors_total{stage="export"} increase over 15m. Counted per export attempt — retries can count more than once per batch. Alert: any sustained increase (ktb-telemetry-export-errors).',
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(0, 1, 8, 4))
				.unit("short")
				.decimals(0)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.thresholds(
					new ThresholdsConfigBuilder().mode(ThresholdsMode.Absolute).steps([
						{ color: "green", value: null },
						{ color: "red", value: 1 },
					]),
				)
				.withTarget(prom("A", 'sum(increase(ktb_telemetry_errors_total{stage="export"}[15m]))')),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(3)
				.title("Ingest errors (15m)")
				.description(
					'ktb_telemetry_errors_total{stage="ingest"} increase — failures inside the /api/telemetry client-event ingest path.',
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(8, 1, 8, 4))
				.unit("short")
				.decimals(0)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.withTarget(prom("A", 'sum(increase(ktb_telemetry_errors_total{stage="ingest"}[15m]))')),
		)
		.withPanel(
			new StatPanelBuilder()
				.id(4)
				.title("Flush timeouts (15m)")
				.description(
					'ktb_telemetry_errors_total{stage="flush"} increase — bounded drain timeouts at worker shutdown/lifecycle flush.',
				)
				.datasource(DS_PROMETHEUS)
				.gridPos(grid(16, 1, 8, 4))
				.unit("short")
				.decimals(0)
				.colorMode(BigValueColorMode.Value)
				.graphMode(BigValueGraphMode.Area)
				.reduceOptions(lastNotNull())
				.withTarget(prom("A", 'sum(increase(ktb_telemetry_errors_total{stage="flush"}[15m]))')),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(5)
					.title("Telemetry pipeline errors by stage")
					.description(
						"All ktb_telemetry_errors_total series. export = OTLP push failures (telemetry lost at source); ingest = client-event ingest failures; flush = drain timeouts.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 5, 12, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(
						prom(
							"A",
							'sum by (stage) (rate(ktb_telemetry_errors_total{stage=~"$stage"}[$__rate_interval]))',
							"{{stage}}",
						),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(6)
					.title("Client events ingested vs dropped")
					.description(
						"Browser telemetry throughput: accepted events (ktb_client_events_total) vs rejected (ktb_client_events_dropped_total). A widening gap with flat traffic means the client SDK or ingest validation is rejecting payloads.",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 5, 12, 8))
					.unit("ops")
					.decimals(2)
					.withTarget(prom("A", "sum(rate(ktb_client_events_total[$__rate_interval]))", "ingested"))
					.withTarget(
						prom("B", "sum(rate(ktb_client_events_dropped_total[$__rate_interval]))", "dropped"),
					),
			),
		)
		// ---- Row: Client telemetry ------------------------------------------
		.withRow(
			new RowBuilder("Client telemetry")
				.id(7)
				.gridPos(grid(0, 13, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(8)
					.title("Client events by type")
					.description(
						"ktb_client_events_total split by event type: event (custom), error (client.error), navigation (web.navigation), request (web.request).",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(0, 14, 12, 8))
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
					.id(9)
					.title("Client events dropped by reason")
					.description(
						"ktb_client_events_dropped_total — reason: disabled (KTB_TELEMETRY_CLIENT off), invalid (failed schema/sanitization), rate_limited (ingest cap hit), oversized (body over the byte cap), sampled (client sample rate).",
					)
					.datasource(DS_PROMETHEUS)
					.gridPos(grid(12, 14, 12, 8))
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
		// ---- Row: Logs (Loki) ------------------------------------------------
		.withRow(
			new RowBuilder("Logs (Loki)")
				.id(10)
				.gridPos(grid(0, 22, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(11)
					.title("Log volume")
					.description(
						"Total log lines ingested per interval for service_name=ktb (OTLP logs → Loki). Includes http.access records — one per HTTP request — so this roughly tracks request volume plus app log lines.",
					)
					.datasource(DS_LOKI)
					.gridPos(grid(0, 23, 12, 8))
					.unit("short")
					.decimals(0)
					.withTarget(
						loki("A", 'sum(count_over_time({service_name="ktb"}[$__interval]))', "lines/interval"),
					),
			),
		)
		.withPanel(
			timeseriesStyle(
				new TimeseriesPanelBuilder()
					.id(12)
					.title("http.access 5xx lines")
					.description(
						"Access-log records with status >= 500 per interval. Cross-check against the 5xx ratio on the RED dashboard — divergence means logs and metrics disagree (e.g. middleware ordering).",
					)
					.datasource(DS_LOKI)
					.gridPos(grid(12, 23, 12, 8))
					.unit("short")
					.decimals(0)
					.withTarget(
						// OTLP log attributes land in Loki as structured
						// metadata, not in the JSON body — `| json` would
						// parse nothing. A bare label filter matches both
						// stream labels and structured metadata.
						loki(
							"A",
							'sum(count_over_time({service_name="ktb"} | status >= 500 [$__interval]))',
							"5xx lines/interval",
						),
					),
			),
		)
		.withPanel(
			new LogsPanelBuilder()
				.id(13)
				.title("Recent client.* / error log records")
				.description(
					"Raw Loki lines for client telemetry events (client.event / client.error / client.navigation / client.request) and pipeline errors. Each carries traceId when the request propagated a traceparent — click through to Tempo via the derived field.",
				)
				.datasource(DS_LOKI)
				.gridPos(grid(0, 31, 24, 9))
				.showTime(true)
				.wrapLogMessage(true)
				.sortOrder(LogsSortOrder.Descending)
				.withTarget(loki("A", '{service_name="ktb"} |~ "client\\.|telemetry\\.(ingest|flush)"')),
		)
		// ---- Row: Traces (Tempo) ----------------------------------------------
		.withRow(
			new RowBuilder("Traces (Tempo)")
				.id(14)
				.gridPos(grid(0, 40, 24, 1))
				.collapsed(false),
		)
		.withPanel(
			new TablePanelBuilder()
				.id(15)
				.title("Recent error traces")
				.description(
					"Tempo traceql search for service.name=ktb with status=error, newest first. Tail sampling keeps ALL error traces, so this list is complete even though only ~15% of healthy traffic is stored. Click a trace to open it in Explore.",
				)
				.datasource(DS_TEMPO)
				.gridPos(grid(0, 41, 24, 10))
				.withTarget(tempoSearch("A", '{ resource.service.name = "ktb" && status = error }', 20)),
		)
		.withPanel(
			new TextPanelBuilder()
				.id(16)
				.title("Tail sampling context")
				.description("Why trace panels look sparse")
				.gridPos(grid(0, 51, 24, 6))
				.mode(TextMode.Markdown)
				.content(
					[
						"Traces pass through a **tail_sampling** processor in the collector (`infra/lgtm/otelcol-config.yaml`):",
						"",
						"- **Keep** every trace containing an error span (`status_code = ERROR`)",
						"- **Keep** traces slower than **2s** end-to-end",
						"- **Sample** the remaining ~**15%** probabilistically",
						"",
						"Metrics are generated app-side (`effect/Metric` → OTLP metrics), **not** derived from traces — so sampling cannot skew the RED panels. For volume questions use metrics, not trace counts.",
						"",
						'Span names include `app.run`, `app.runAs`, `queue.audio.transcribe`. Narrow searches with `{ span.http.route = "..." }`, `{ duration > 2s }` or `{ status = ok }`.',
					].join("\n"),
				),
		);
