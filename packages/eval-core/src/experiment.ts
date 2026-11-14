import type { CalibrationReport, Experiment } from "./schema.ts";

/**
 * experiment.ts — experiment comparison + calibration rendering (P-076).
 *
 * Pure functions over the persisted artifacts: `eval report --compare`
 * diffs two Experiments (identity fields + the open `summary` metrics
 * bag), `eval calibrate` renders its CalibrationReport as markdown.
 * No I/O, no domain vocabulary — summary values are JSON, compared
 * structurally.
 */

export interface ExperimentDiffRow {
	readonly field: string;
	readonly a: string;
	readonly b: string;
	/** Numeric delta (b − a) when both sides are finite numbers. */
	readonly delta?: number;
	readonly changed: boolean;
}

export interface ExperimentDiff {
	readonly a: Experiment;
	readonly b: Experiment;
	readonly rows: readonly ExperimentDiffRow[];
}

const fmt = (v: unknown): string => {
	if (v === undefined || v === null) return "-";
	if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return String(v);
	return JSON.stringify(v);
};

const row = (field: string, a: unknown, b: unknown): ExperimentDiffRow => {
	const sa = fmt(a);
	const sb = fmt(b);
	const na = typeof a === "number" ? a : undefined;
	const nb = typeof b === "number" ? b : undefined;
	return {
		field,
		a: sa,
		b: sb,
		...(na !== undefined && nb !== undefined ? { delta: nb - na } : {}),
		changed: sa !== sb,
	};
};

const summaryKeys = (a: Experiment, b: Experiment): readonly string[] =>
	[...new Set([...Object.keys(a.summary), ...Object.keys(b.summary)])].sort();

/** Diff two experiments — identity fields first (kind, suite, dataset,
 * profile, reproducibility fingerprint), then every summary metric
 * key present on either side. `changed` marks any field whose rendered
 * value differs; `delta` is populated only for number↔number pairs. */
export const diffExperiments = (a: Experiment, b: Experiment): ExperimentDiff => {
	const rows: ExperimentDiffRow[] = [
		row("kind", a.kind, b.kind),
		row("suite", a.suiteId, b.suiteId),
		row("dataset", `${a.dataset.id}@${a.dataset.version}`, `${b.dataset.id}@${b.dataset.version}`),
		row("profile", a.profile, b.profile),
		row("manifestHash", a.manifestHash, b.manifestHash),
		row("gitSha", a.gitSha, b.gitSha),
		row("startedAt", a.startedAt, b.startedAt),
	];
	for (const key of summaryKeys(a, b)) {
		rows.push(row(`summary.${key}`, a.summary[key], b.summary[key]));
	}
	const ga = new Map((a.gates ?? []).map((g) => [g.id, g]));
	const gb = new Map((b.gates ?? []).map((g) => [g.id, g]));
	for (const id of [...new Set([...ga.keys(), ...gb.keys()])].sort()) {
		const x = ga.get(id);
		const y = gb.get(id);
		rows.push(
			row(
				`gate.${id}`,
				x === undefined ? "-" : `${x.green ? "GREEN" : "RED"} ${x.accepted}/${x.total}`,
				y === undefined ? "-" : `${y.green ? "GREEN" : "RED"} ${y.accepted}/${y.total}`,
			),
		);
	}
	return { a, b, rows };
};

const mdCell = (s: string): string => s.replaceAll("|", "\\|");

/** Markdown rendering of `diffExperiments` — the `eval report
 * --compare` output shape. */
export const renderExperimentCompareMarkdown = (diff: ExperimentDiff): string => {
	const { a, b, rows } = diff;
	const lines = [
		`# experiment compare`,
		``,
		`- A: \`${a.id}\` (${a.kind}, suite ${a.suiteId}, profile ${a.profile})`,
		`- B: \`${b.id}\` (${b.kind}, suite ${b.suiteId}, profile ${b.profile})`,
		``,
		`| field | A | B | delta |`,
		`|---|---|---|---|`,
	];
	for (const r of rows) {
		const delta = r.delta !== undefined ? String(r.delta) : r.changed ? "changed" : "";
		lines.push(`| ${mdCell(r.field)} | ${mdCell(r.a)} | ${mdCell(r.b)} | ${mdCell(delta)} |`);
	}
	lines.push("");
	return lines.join("\n");
};

const pct = (n: number, d: number): string => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);

/** Markdown rendering of a CalibrationReport — the `eval calibrate`
 * console output. */
export const renderCalibrationMarkdown = (report: CalibrationReport): string => {
	const lines = [
		`# judge calibration — ${report.suiteId}`,
		``,
		`- report \`${report.id}\` · dataset ${report.dataset.id}@${report.dataset.version}` +
			(report.runId !== undefined ? ` · run ${report.runId}` : ""),
		`- ${report.questions} question(s) over ${report.samples} sample(s): ` +
			`${report.agreements} agreement(s), rate ${pct(report.agreements, report.questions)}, ` +
			`Wilson floor ${(report.lowerBound * 100).toFixed(1)}%`,
		`- judges: ${
			report.judges.length === 0
				? "none recorded"
				: report.judges
						.map((j) => `${j.engine}${j.model !== undefined ? `/${j.model}` : ""}`)
						.join(", ")
		}`,
		``,
		`| kind | n | agreements | rate |`,
		`|---|---|---|---|`,
	];
	for (const k of report.kinds) {
		lines.push(`| ${k.kind} | ${k.n} | ${k.agreements} | ${pct(k.agreements, k.n)} |`);
	}
	lines.push(``, `| confidence | n | agreements | rate |`, `|---|---|---|---|`);
	for (const b of report.buckets) {
		const band = b.lo === -1 && b.hi === -1 ? "unscored" : `[${b.lo}, ${b.hi})`;
		lines.push(`| ${band} | ${b.count} | ${b.agreements} | ${pct(b.agreements, b.count)} |`);
	}
	lines.push("");
	return lines.join("\n");
};
