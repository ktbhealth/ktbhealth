import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardListIcon, DownloadIcon, SearchIcon } from "lucide-react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { buttonVariants } from "@ktbhealth/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";
import { Input } from "@ktbhealth/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@ktbhealth/ui/components/tabs";

import { BADGE_TONES, SOURCE_LABEL } from "./-ui.ts";

const FILTERS = [
	["all", "All"],
	["anamnesis", "With anamnesis"],
	["pending", "Pending"],
] as const;

function initials(name: string | null) {
	if (!name) return "?";
	const parts = name.trim().split(/\s+/);
	return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function ToneBadge({
	children,
	tone = "neutral",
}: {
	children: React.ReactNode;
	tone?: keyof typeof BADGE_TONES;
}) {
	return (
		<Badge variant="secondary" className={`ring-1 ${BADGE_TONES[tone]}`}>
			{children}
		</Badge>
	);
}

export interface ConsultationListItem {
	id: number;
	engine: string | null;
	createdAt: Date;
	transcript: string;
	source: string | null;
	status: string;
	consentAt: Date | null;
	/** Absent on rows from older callers; null when unlinked. */
	patientId?: number | null;
	patientName: string | null;
	chiefComplaint: string | null;
	hasAnamnesis: boolean;
}

export function ConsultationsPage({ consultations }: { consultations: ConsultationListItem[] }) {
	const [q, setQ] = useState("");
	const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");

	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return consultations.filter((c) => {
			if (filter === "anamnesis" && !c.hasAnamnesis) return false;
			if (filter === "pending" && c.hasAnamnesis) return false;
			if (!needle) return true;
			return [c.patientName, c.chiefComplaint, c.transcript, String(c.id)]
				.filter(Boolean)
				.some((t) => (t as string).toLowerCase().includes(needle));
		});
	}, [consultations, q, filter]);

	return (
		<div>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Consultations</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{consultations.length === 0
							? "No consultations yet."
							: `${consultations.length} consultation${consultations.length > 1 ? "s" : ""} recorded.`}
					</p>
				</div>
				<Link to="/consultations/new" className={buttonVariants()}>
					+ New consultation
				</Link>
			</div>

			{consultations.length > 0 ? (
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<div className="relative w-full max-w-sm">
						<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="search"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="Search by patient, complaint, or text…"
							aria-label="Search consultations"
							className="pl-8"
						/>
					</div>
					<Tabs
						value={filter}
						onValueChange={(v) => setFilter(v as (typeof FILTERS)[number][0])}
						className="w-fit"
					>
						<TabsList aria-label="Filter consultations">
							{FILTERS.map(([key, label]) => (
								<TabsTrigger key={key} value={key}>
									{label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
				</div>
			) : null}

			<div className="mt-5 space-y-3">
				{shown.map((c) => (
					<article
						key={c.id}
						className="group relative flex items-start gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-foreground/20 hover:shadow"
					>
						<div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-semibold text-primary">
							{initials(c.patientName)}
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-baseline gap-x-2">
								<Link
									to="/consultations/$id"
									params={{ id: String(c.id) }}
									className="font-semibold after:absolute after:inset-0 after:content-['']"
								>
									{c.patientName ?? "Unlinked patient"}
								</Link>
								<span className="text-xs text-muted-foreground">
									#{c.id} · {new Date(c.createdAt).toLocaleString()}
								</span>
								{c.patientId ? (
									<Link
										to="/patients/$id"
										params={{ id: String(c.patientId) }}
										className="relative z-10 text-xs text-primary hover:underline"
									>
										Patient record
									</Link>
								) : null}
							</div>
							<p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
								{c.chiefComplaint && !c.chiefComplaint.startsWith("A preencher")
									? c.chiefComplaint
									: c.transcript || "No transcript."}
							</p>
							<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
								{c.status === "live" ? <ToneBadge tone="red">● live</ToneBadge> : null}
								{c.hasAnamnesis ? (
									<ToneBadge tone="green">Anamnesis</ToneBadge>
								) : (
									<ToneBadge tone="amber">No anamnesis</ToneBadge>
								)}
								{c.consentAt ? <ToneBadge tone="green">Consent ✓</ToneBadge> : null}
								<ToneBadge>{SOURCE_LABEL[c.source ?? ""] ?? c.source}</ToneBadge>
							</div>
						</div>
						{c.hasAnamnesis ? (
							<a
								href={`/api/consultations/${c.id}/pdf`}
								download
								title="Download anamnesis PDF"
								className={`${buttonVariants({ variant: "outline", size: "sm" })} relative z-10 shrink-0`}
							>
								<DownloadIcon className="mr-1 inline size-3.5 -translate-y-px" />
								PDF
							</a>
						) : null}
					</article>
				))}

				{consultations.length > 0 && shown.length === 0 ? (
					<Empty className="border">
						<EmptyDescription>No consultations match the search.</EmptyDescription>
					</Empty>
				) : null}

				{!consultations.length ? (
					<Empty className="border bg-card px-6 py-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<ClipboardListIcon />
							</EmptyMedia>
							<EmptyTitle>No consultations yet</EmptyTitle>
							<EmptyDescription>
								Start a consultation to record the conversation and generate the anamnesis.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Link to="/consultations/new" className={buttonVariants()}>
								Start consultation
							</Link>
						</EmptyContent>
					</Empty>
				) : null}
			</div>
		</div>
	);
}
