import type { JobStatusValue } from "@ktbhealth/ui/components/job-status";

import type { ConsoleJob } from "./context.ts";
import { jobMessages } from "./i18n.ts";

/** Minimal row shape the mapper needs — AdminConsultationRow satisfies it. */
export interface AudioJobRow {
	readonly id: number;
	readonly audioStatus: string;
	readonly audioError: string | null;
	readonly createdAt: Date | string;
	readonly patientName?: string | null;
}

const STATUS_MAP: Record<string, JobStatusValue | undefined> = {
	stored: "queued",
	queued: "queued",
	processing: "processing",
	done: "done",
	failed: "failed",
};

const fmtDate = (value: Date | string, locale: string): string => {
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale);
};

/**
 * Map consultation audio-pipeline rows to console jobs. Rows with
 * `audioStatus: "none"` (no recording) are skipped — they are not jobs.
 * `locale` localizes the job title/description copy.
 */
export const jobsFromAudioRows = (rows: readonly AudioJobRow[], locale = "en"): ConsoleJob[] => {
	const t = jobMessages(locale);
	return rows.flatMap((row) => {
		const status = STATUS_MAP[row.audioStatus];
		if (status === undefined) return [];
		return [
			{
				id: `audio-${row.id}`,
				title: t.jobTitle,
				description: row.patientName ?? t.consultationRef(row.id),
				status,
				meta: row.audioError ?? fmtDate(row.createdAt, locale),
				...(row.audioError ? { error: row.audioError } : {}),
			},
		];
	});
};

/**
 * Single-row variant for live SSE deltas (`/api/jobs` frames carry one
 * AudioJobRow at a time) — null when the row isn't a job
 * (audioStatus "none" or unmapped), so callers can drop it.
 */
export const jobFromAudioRow = (row: AudioJobRow, locale = "en"): ConsoleJob | null =>
	jobsFromAudioRows([row], locale)[0] ?? null;
