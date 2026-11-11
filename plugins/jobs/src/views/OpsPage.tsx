import { useRouter } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@ktbhealth/ui/components/button";
import { ConfirmDialog } from "@ktbhealth/ui/components/confirm-dialog";
import { DataToolbar } from "@ktbhealth/ui/components/data-toolbar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import { Input } from "@ktbhealth/ui/components/input";
import { JobStatus, type JobStatusValue } from "@ktbhealth/ui/components/job-status";
import { PageContainer } from "@ktbhealth/ui/components/page-container";
import { PageHeader } from "@ktbhealth/ui/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";
import type { AudioStorageStats, QueueDepth } from "@ktb/server-fns";

import { retryAudioJobFn } from "../fns.ts";
import { isAudioRetryable, jobStatusOf, type AudioJobRow } from "../jobs.ts";
import { opsMessages, type OpsMessages } from "../i18n.ts";

const SEARCH_CLS = "w-56 sm:w-64";

const fmtDate = (value: Date | string, locale: string): string => {
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale);
};

const fmtBytes = (bytes: number, locale: string): string => {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
};

const statusLabel = (t: OpsMessages, status: string): string => {
	switch (status) {
		case "stored":
			return t.statusStored;
		case "queued":
			return t.statusQueued;
		case "processing":
			return t.statusProcessing;
		case "done":
			return t.statusDone;
		case "failed":
			return t.statusFailed;
		default:
			return status;
	}
};

/** Shared section chrome — dense console card with a titled header. */
function OpsSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="overflow-hidden rounded-lg border border-border">
			<header className="border-b border-border px-3 py-2">
				<h2 className="text-sm font-medium">{title}</h2>
				{description !== undefined ? (
					<p className="text-xs text-muted-foreground">{description}</p>
				) : null}
			</header>
			<div className="p-3">{children}</div>
		</section>
	);
}

/** Unavailable-signal placeholder — honest "cannot read" state. */
function Unavailable({ t }: { t: OpsMessages }) {
	return (
		<Empty className="border-0 py-6">
			<EmptyHeader>
				<EmptyTitle className="text-sm">{t.unavailableTitle}</EmptyTitle>
				<EmptyDescription className="text-xs">{t.unavailableDescription}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

/**
 * /platform/ops console view (T-035) — aggregates the ops signals that
 * actually exist: the consultation audio-pipeline job table (with admin
 * retry for failed/stored rows), the transcription queue depth (dev
 * queue only — prod reports unavailable), audio bucket storage stats,
 * and a webhook section that reports its missing delivery log instead
 * of faking data. Dense/utilitarian by design (system console).
 */
export function OpsPage({
	jobs,
	queue,
	storage,
	locale = "en",
}: {
	/** null = the signal could not be read (Forbidden/runtime missing). */
	jobs: readonly AudioJobRow[] | null;
	queue: QueueDepth | null;
	storage: AudioStorageStats | null;
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = opsMessages(locale);
	const router = useRouter();
	const [q, setQ] = useState("");
	const [retrying, setRetrying] = useState<AudioJobRow | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);

	const jobRows = useMemo(
		() => (jobs ?? []).filter((j) => jobStatusOf(j.audioStatus) !== null),
		[jobs],
	);
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return jobRows;
		return jobRows.filter((job) =>
			[job.patientName ?? "", String(job.id), job.audioError ?? ""]
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [jobRows, needle]);

	const confirmRetry = async (job: AudioJobRow) => {
		setRetrying(null);
		setBusy(true);
		setError(false);
		try {
			const res = await retryAudioJobFn({ data: { consultationId: job.id } });
			if (!res.ok) {
				setError(true);
				return;
			}
			await router.invalidate();
		} finally {
			setBusy(false);
		}
	};

	return (
		<PageContainer>
			<PageHeader
				title={t.title}
				description={jobs === null ? undefined : t.description(jobRows.length)}
			/>
			<div className="flex flex-col gap-4">
				<OpsSection title={t.jobsTitle} description={t.jobsDescription}>
					{jobs === null ? (
						<Unavailable t={t} />
					) : jobRows.length === 0 ? (
						<Empty className="border">
							<EmptyHeader>
								<EmptyTitle>{t.emptyJobsTitle}</EmptyTitle>
								<EmptyDescription>{t.emptyJobsDescription}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<>
							<DataToolbar
								search={
									<Input
										type="search"
										value={q}
										onChange={(e) => setQ(e.target.value)}
										placeholder={t.searchPlaceholder}
										aria-label={t.searchLabel}
										className={SEARCH_CLS}
									/>
								}
								resultCount={needle === "" ? undefined : `${shown.length}/${jobRows.length}`}
							/>
							{error ? <p className="mb-2 text-xs text-destructive">{t.retryError}</p> : null}
							<div className="overflow-hidden rounded-lg border border-border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="w-20">{t.colConsultation}</TableHead>
											<TableHead>{t.colPatient}</TableHead>
											<TableHead>{t.colStatus}</TableHead>
											<TableHead>{t.colError}</TableHead>
											<TableHead className="text-right">{t.colCreated}</TableHead>
											<TableHead className="text-right">{t.colActions}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{shown.length === 0 ? (
											<TableRow>
												<TableCell colSpan={6} className="text-xs text-muted-foreground">
													{t.noMatch}
												</TableCell>
											</TableRow>
										) : (
											shown.map((job) => {
												const badge = jobStatusOf(job.audioStatus) as JobStatusValue;
												return (
													<TableRow key={job.id}>
														<TableCell className="font-mono text-xs">#{job.id}</TableCell>
														<TableCell className="text-xs">
															{job.patientName ?? t.noPatient}
														</TableCell>
														<TableCell>
															<JobStatus status={badge} label={statusLabel(t, job.audioStatus)} />
														</TableCell>
														<TableCell className="max-w-56 truncate text-xs text-muted-foreground">
															{job.audioError ?? ""}
														</TableCell>
														<TableCell className="text-right text-xs text-muted-foreground">
															{fmtDate(job.createdAt, locale)}
														</TableCell>
														<TableCell className="text-right">
															{isAudioRetryable(job.audioStatus) ? (
																<Button
																	type="button"
																	variant="ghost"
																	size="sm"
																	disabled={busy}
																	onClick={() => setRetrying(job)}
																>
																	{t.retry}
																</Button>
															) : null}
														</TableCell>
													</TableRow>
												);
											})
										)}
									</TableBody>
								</Table>
							</div>
						</>
					)}
				</OpsSection>

				<OpsSection title={t.queueTitle} description={t.queueDescription}>
					{queue === null ? (
						<Unavailable t={t} />
					) : (
						<dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
							{(
								[
									["pending", t.queuePending],
									["processing", t.queueProcessing],
									["done", t.queueDone],
									["failed", t.queueFailed],
								] as const
							).map(([key, label]) => (
								<div key={key} className="rounded-md border border-border px-3 py-2">
									<dt className="text-xs text-muted-foreground">{label}</dt>
									<dd className="text-lg font-semibold tabular-nums">{queue[key]}</dd>
								</div>
							))}
						</dl>
					)}
				</OpsSection>

				<OpsSection title={t.storageTitle} description={t.storageDescription}>
					{storage === null ? (
						<Unavailable t={t} />
					) : (
						<div className="flex flex-col gap-1">
							<p className="text-sm">
								<span className="font-semibold tabular-nums">
									{t.storageObjects(storage.objects)}
								</span>{" "}
								<span className="text-muted-foreground">· {fmtBytes(storage.bytes, locale)}</span>
							</p>
							{storage.truncated ? (
								<p className="text-xs text-muted-foreground">{t.storageTruncated}</p>
							) : null}
						</div>
					)}
				</OpsSection>

				<OpsSection title={t.webhooksTitle} description={t.webhooksDescription}>
					<p className="text-xs text-muted-foreground">{t.webhooksUnavailable}</p>
				</OpsSection>
			</div>
			{retrying !== null ? (
				<ConfirmDialog
					open
					onOpenChange={(open) => {
						/* v8 ignore next -- mounted only while retrying; only close events fire */
						if (!open) setRetrying(null);
					}}
					title={t.retryTitle}
					description={t.retryDescription(`#${retrying.id}`)}
					confirmLabel={t.retryConfirm}
					cancelLabel={t.cancel}
					loading={busy}
					onConfirm={() => confirmRetry(retrying)}
				/>
			) : null}
		</PageContainer>
	);
}
