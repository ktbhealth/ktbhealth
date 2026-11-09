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
 * Header action contributed via `panel.headerActions`: a tooltip'd icon
 * button opening a wide popover with the console jobs feed — status
 * filter tabs, batch progress and grouped queue sections. Data comes
 * from JobsDataContext (the host injects it); empty state when none.
 */
export function JobsHeaderAction() {
	const jobs = React.useContext(JobsDataContext);
	const [filter, setFilter] = React.useState<JobStatusFilter>("all");
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
									<Button
										variant="ghost"
										size="icon"
										className="relative"
										aria-label="Background jobs"
									/>
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
					<TooltipContent>Background jobs</TooltipContent>
				</Tooltip>
				<PopoverContent align="end" className="w-96 p-0">
					<PopoverHeader className="border-b border-border px-3 py-2">
						<PopoverTitle className="flex items-center justify-between text-sm">
							<span>Background jobs</span>
							<span className="text-xs font-normal text-muted-foreground">
								{active.length} active
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
										title="No jobs in this state"
										description="Nothing matches the selected filter."
									/>
								)}
							</>
						) : (
							<JobEmptyState
								title="No background jobs"
								description="Transcription, export and sync jobs will appear here."
							/>
						)}
						<div className="border-t border-border pt-2 text-right">
							<Link
								to="/platform/consultations"
								className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
							>
								Open consultations
							</Link>
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	);
}
