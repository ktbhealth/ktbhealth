import type { Builder, Dataquery } from "@grafana/grafana-foundation-sdk/cog";
import type { DataSourceRef } from "@grafana/grafana-foundation-sdk/common";
import type { GridPos } from "@grafana/grafana-foundation-sdk/dashboard";
import { DataqueryBuilder as LokiDataqueryBuilder } from "@grafana/grafana-foundation-sdk/loki";
import { DataqueryBuilder as PrometheusDataqueryBuilder } from "@grafana/grafana-foundation-sdk/prometheus";
import { DataqueryBuilder as TempoDataqueryBuilder } from "@grafana/grafana-foundation-sdk/tempo";
import {
	LegendDisplayMode,
	LegendPlacement,
	ReduceDataOptionsBuilder,
	SortOrder,
	TooltipDisplayMode,
	VizLegendOptionsBuilder,
	VizTooltipOptionsBuilder,
} from "@grafana/grafana-foundation-sdk/common";
import type { PanelBuilder as TimeseriesPanelBuilder } from "@grafana/grafana-foundation-sdk/timeseries";

/**
 * Shared building blocks for the KTB Grafana dashboards. Datasource UIDs
 * must match provisioning/datasources/datasources.yaml — they are pinned
 * there so dashboards keep working across otel-lgtm image upgrades.
 */

export const DS_PROMETHEUS: DataSourceRef = { type: "prometheus", uid: "prometheus" };
export const DS_LOKI: DataSourceRef = { type: "loki", uid: "loki" };
export const DS_TEMPO: DataSourceRef = { type: "tempo", uid: "tempo" };

/** 24-column grid position helper — keeps panel layout readable. */
export const grid = (x: number, y: number, w: number, h: number): GridPos => ({ x, y, w, h });

/** Prometheus range query target. `refId` must be unique within a panel. */
export const prom = (refId: string, expr: string, legendFormat?: string) => {
	const query = new PrometheusDataqueryBuilder()
		.refId(refId)
		.expr(expr)
		.range();
	if (legendFormat !== undefined) query.legendFormat(legendFormat);
	return query;
};

/** Prometheus instant query target (stats/table panels). */
export const promInstant = (refId: string, expr: string, legendFormat?: string) => {
	const query = new PrometheusDataqueryBuilder()
		.refId(refId)
		.expr(expr)
		.instant();
	if (legendFormat !== undefined) query.legendFormat(legendFormat);
	return query;
};

/** Loki LogQL range query target. */
export const loki = (refId: string, expr: string, legendFormat?: string) => {
	const query = new LokiDataqueryBuilder().refId(refId).expr(expr).range(true);
	if (legendFormat !== undefined) query.legendFormat(legendFormat);
	return query;
};

/** Tempo TraceQL search target for trace tables. */
export const tempoSearch = (refId: string, query: string, limit = 20) =>
	new TempoDataqueryBuilder()
		.refId(refId)
		.queryType("traceql")
		.query(query)
		.tableType("traces")
		.limit(limit);

/** Any panel builder that accepts query targets (timeseries/stat/table/logs…). */
export type TargetedPanelBuilder = {
	withTarget(target: Builder<Dataquery>): unknown;
};

/** Standard timeseries chrome: bottom legend + multi tooltip + soft zero floor. */
export const timeseriesStyle = (panel: TimeseriesPanelBuilder) =>
	panel
		.min(0)
		.legend(
			new VizLegendOptionsBuilder()
				.displayMode(LegendDisplayMode.List)
				.placement(LegendPlacement.Bottom)
				.showLegend(true)
				.calcs(["lastNotNull"]),
		)
		.tooltip(new VizTooltipOptionsBuilder().mode(TooltipDisplayMode.Multi).sort(SortOrder.None));

/** `lastNotNull` reduce — the right default for rate/quantile panels. */
export const lastNotNull = () => new ReduceDataOptionsBuilder().calcs(["lastNotNull"]);

/**
 * Explore deep-links reused from the previous hand-written dashboard —
 * they encode the Explore panes URL format Grafana expects.
 */
export const EXPLORE_TRACES_URL =
	'explore?schemaVersion=1&panes=%7B%22traces%22%3A%7B%22datasource%22%3A%22tempo%22%2C%22queries%22%3A%5B%7B%22refId%22%3A%22A%22%2C%22queryType%22%3A%22traceqlSearch%22%2C%22query%22%3A%22%7B%20resource.service.name%20%3D%20%5C%22ktb%5C%22%20%7D%22%7D%5D%7D%7D&orgId=1';
export const EXPLORE_LOGS_URL =
	'explore?schemaVersion=1&panes=%7B%22logs%22%3A%7B%22datasource%22%3A%22loki%22%2C%22queries%22%3A%5B%7B%22refId%22%3A%22A%22%2C%22expr%22%3A%22%7Bservice_name%3D%5C%22ktb%5C%22%7D%22%7D%5D%7D%7D&orgId=1';
