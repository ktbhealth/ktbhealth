import type { JobStatusValue } from "@ktbhealth/ui/components/job-status";

import type { ConsoleJob } from "./context.ts";

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

const fmtDate = (value: Date | string): string => {
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
};

/**
 * Map consultation audio-pipeline rows to console jobs. Rows with
 * `audioStatus: "none"` (no recording) are skipped — they are not jobs.
 */
export const jobsFromAudioRows = (rows: readonly AudioJobRow[]): ConsoleJob[] =>
	rows.flatMap((row) => {
		const status = STATUS_MAP[row.audioStatus];
		if (status === undefined) return [];
		return [
			{
				id: `audio-${row.id}`,
				title: "Audio transcription",
				description: row.patientName ?? `consultation #${row.id}`,
				status,
				meta: row.audioError ?? fmtDate(row.createdAt),
				...(row.audioError ? { error: row.audioError } : {}),
			},
		];
	});
