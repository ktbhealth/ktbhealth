import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ListTodoIcon } from "lucide-react";

import { Button } from "@ktbhealth/ui/components/button";
import {
	JobBatchProgress,
	JobEmptyState,
	JobItem,
	JobList,
	JobQueue,
	JobStatusTabs,
	type JobStatusFilter,
} from "@ktbhealth/ui/components/job-status";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@ktbhealth/ui/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@ktbhealth/ui/components/tooltip";

import { jobFromAudioRow, type AudioJobRow } from "../jobs.ts";
import { jobMessages } from "../i18n.ts";
import { JobsDataContext, type ConsoleJob } from "../context.ts";

const GROUP_ORDER = ["processing", "queued", "failed", "done"] as const;

const jobItemProps = (job: ConsoleJob) => ({
	title: job.title,
	description: job.error ? `${job.description ?? ""} — ${job.error}`.trim() : job.description,
	status: job.status,
	...(job.progress !== undefined ? { progress: job.progress } : {}),
	...(job.meta ? { meta: job.meta } : {}),
});

/**
 * Upsert one live frame into the job list, keyed by job id. Known jobs
 * update in place (a status transition keeps its queue position); new
 * jobs land on top — the stream's backlog is createdAt-desc, so the
 * freshest deltas surface first. A frame mapping to no job removes the
 * id (e.g. the row's audio status reset to a non-job state).
 */
const upsertJob = (
	list: readonly ConsoleJob[],
	id: string,
	job: ConsoleJob | null,
): readonly ConsoleJob[] => {
	const idx = list.findIndex((j) => j.id === id);
	if (job === null) return idx >= 0 ? list.filter((j) => j.id !== id) : list;
	if (idx >= 0) return list.map((j, i) => (i === idx ? job : j));
	return [job, ...list];
};

/**
 * Header action contributed via `panel.headerActions`: a tooltip'd icon
 * button opening a wide popover with the console jobs feed — status
 * filter tabs, batch progress and grouped queue sections. Data comes
 * from JobsDataContext (the host injects it) as the seed; when
 * EventSource is available the component opens /api/jobs — an
 * admin-gated SSE feed that replays the audio-pipeline rows then pushes
 * one fresh row per consultation.audioUpdated event — and upserts each
 * frame by job id (`live` stays null until the first frame so the seed
 * renders meanwhile; without EventSource, e.g. jsdom tests, the seed is
 * authoritative). Empty state when none.
 */
export function JobsHeaderAction({ locale = "en" }: { locale?: string }) {
	const t = jobMessages(locale);
	const seeded = React.useContext(JobsDataContext);
	// null → context seed is authoritative (no live connection yet/ever).
	const [live, setLive] = React.useState<readonly ConsoleJob[] | null>(null);
	const jobs = live ?? seeded;
	const [filter, setFilter] = React.useState<JobStatusFilter>("all");

	React.useEffect(() => {
		if (typeof EventSource === "undefined") return;
		const source = new EventSource("/api/jobs");
		// Each frame is one AudioJobRow (the stream's backlog replays the
		// same projection the loader seeded — upserts dedupe by id).
		source.onmessage = (event) => {
			try {
				const row = JSON.parse(event.data) as AudioJobRow;
				const job = jobFromAudioRow(row, locale);
				setLive((prev) => upsertJob(prev ?? seeded, `audio-${row.id}`, job));
			} catch {
				// Malformed frame — ignore.
			}
		};
		return () => source.close();
	}, [seeded, locale]);

	const active = jobs.filter((j) => j.status === "queued" || j.status === "processing");

	const visible = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);
	const groups = GROUP_ORDER.map((status) => ({
		status,
		collapsible: status === "done",
		defaultOpen: status !== "done",
		jobs: visible
			.filter((j) => j.status === status)
			.map((j) => ({ ...jobItemProps(j), key: j.id })),
	})).filter((g) => g.jobs.length > 0);

	const counts: Partial<Record<JobStatusFilter, number>> = { all: jobs.length };
	for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

	return (
		<TooltipProvider>
			<Popover>
				<Tooltip>
					<TooltipTrigger
						render={
							<PopoverTrigger
								render={
									<Button variant="ghost" size="icon" className="relative" aria-label={t.label} />
								}
							/>
						}
					>
						<ListTodoIcon className="size-4" />
						{active.length > 0 ? (
							<span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
								{active.length}
							</span>
						) : null}
					</TooltipTrigger>
					<TooltipContent>{t.label}</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-96 p-0">
					<PopoverHeader className="border-b border-border px-3 py-2">
						<PopoverTitle className="flex items-center justify-between text-sm">
							<span>{t.label}</span>
							<span className="text-xs font-normal text-muted-foreground">
								{t.activeCount(active.length)}
							</span>
						</PopoverTitle>
					</PopoverHeader>
					<div className="space-y-3 p-3">
						{jobs.length > 0 ? (
							<>
								<JobBatchProgress jobs={jobs.map((j) => j.status)} />
								<JobStatusTabs value={filter} onValueChange={setFilter} counts={counts} />
								{groups.length > 0 ? (
									<JobQueue groups={groups} />
								) : (
									<JobEmptyState
										title={t.emptyFilteredTitle}
										description={t.emptyFilteredDescription}
									/>
								)}
							</>
						) : (
							<JobEmptyState title={t.emptyAllTitle} description={t.emptyAllDescription} />
						)}
						<div className="border-t border-border pt-2 text-right">
							<Link
								to="/platform/consultations"
								className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
							>
								{t.openConsultations}
							</Link>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	);
}
