import type { RunRecord } from "./schema.ts";

/**
 * Render one run's records as a markdown table — the single shape both
 * ReportPort adapters emit (local JSONL→markdown, in-memory stub), so
 * consumers can assert on render output regardless of adapter. Cells
 * escape `|` so engine/model strings can't corrupt the table.
 */
export const renderRunMarkdown = (runId: string, records: readonly RunRecord[]): string => {
	const rows = records.filter((r) => r.runId === runId);
	if (rows.length === 0) return `# run ${runId}\n\nno records\n`;
	const cell = (v: string | number | undefined): string => String(v ?? "-").replaceAll("|", "\\|");
	const lines = rows.map(
		(r) =>
			`| ${cell(r.sampleId)} | ${cell(r.stage)} | ${cell(r.engine)} | ${cell(r.model)} | ` +
			`${cell(r.latencyMs)} | ${cell(r.estCostUsd)} |`,
	);
	return [
		`# run ${runId}`,
		"",
		"| sample | stage | engine | model | latency ms | est cost $ |",
		"|---|---|---|---|---|---|",
		...lines,
		"",
	].join("\n");
};
