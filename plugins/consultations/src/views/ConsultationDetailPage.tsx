import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeftIcon, ClipboardListIcon, DownloadIcon } from "lucide-react";

import { anamnesisToText } from "@ktb/anamnesis";
import { CONFIDENCE_LABELS, HISTORY_SECTION_LABEL, SECTION_LABELS } from "@ktb/anamnesis";
import type { Anamnesis, AnamnesisSectionKey, PatientHistory } from "@ktb/anamnesis";
import { Toast, type ToastData } from "@ktbhealth/ui/components/app-toast";
import { Badge } from "@ktbhealth/ui/components/badge";
import { Button, buttonVariants } from "@ktbhealth/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";

import { BADGE_TONES, CONF_BAR, CONF_STYLE, SOURCE_LABEL } from "./-ui.ts";
import {
	AudioTranscriptPanel,
	useConsultationAudio,
	type ConsultationAudioInfo,
} from "./-transcript.tsx";

/** Sections that read better side by side. */
const WIDE: AnamnesisSectionKey[] = ["queixa_principal", "hda", "hipoteses", "conduta"];

function Chip({
	children,
	tone = "neutral",
}: {
	children: React.ReactNode;
	tone?: "neutral" | "green" | "amber";
}) {
	return (
		<Badge variant="secondary" className={`ring-1 ${BADGE_TONES[tone]}`}>
			{children}
		</Badge>
	);
}

export interface ConsultationDetail {
	id: number;
	userId: string | null;
	patientId: number | null;
	transcript: string;
	anamnesis: Anamnesis | null;
	engine: string | null;
	source: string | null;
	status: string;
	botId: string | null;
	consentAt: Date | null;
	createdAt: Date;
	patientName: string | null;
	/** Audio pipeline fields (P-015..P-017) — null/none on older rows. */
	audioKey: string | null;
	audioStatus: string;
	audioError: string | null;
	serverTranscript: string | null;
	correctedTranscript: string | null;
	enhancementEngine: string | null;
}

/** Optional live refetch — enables polling while the audio pipeline runs. */
export interface ConsultationDetailApi {
	getConsultation(input: { data: number }): Promise<ConsultationAudioInfo | null>;
}

const PIPELINE_IN_FLIGHT = new Set(["stored", "queued", "processing"]);

export function ConsultationDetailPage({
	c,
	history,
	api,
}: {
	c: ConsultationDetail;
	history: PatientHistory | null;
	api?: ConsultationDetailApi;
}) {
	const [toast, setToast] = useState<ToastData | null>(null);
	// Poll only when the loader data says the pipeline may still be
	// running (or the LLM cleanup is pending); the hook stops itself
	// once the job reaches a terminal state.
	const pipelineActive =
		PIPELINE_IN_FLIGHT.has(c.audioStatus) ||
		(c.audioStatus === "done" && Boolean(c.serverTranscript) && !c.correctedTranscript);
	const live = useConsultationAudio(api && pipelineActive ? api.getConsultation : undefined, c.id);
	const v = live ?? c;
	const when = new Date(c.createdAt).toLocaleString("en-US", {
		dateStyle: "long",
		timeStyle: "short",
	});

	function copy() {
		/* v8 ignore next -- copy button only renders when anamnesis exists */
		if (!c.anamnesis) return;
		void navigator.clipboard
			.writeText(anamnesisToText(c.anamnesis))
			.then(() => setToast({ id: Date.now(), text: "Anamnesis copied" }));
	}

	return (
		<div>
			<Button variant="ghost" size="sm" className="-ml-2" render={<Link to="/consultations" />}>
				<ArrowLeftIcon />
				Consultations
			</Button>

			{/* ---------- header ---------- */}
			<header className="mt-3 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">
						{c.patientName ?? `Consultation #${c.id}`}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Consultation #{c.id} · {when}
					</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						<Chip>{SOURCE_LABEL[c.source ?? ""] ?? c.source}</Chip>
						{c.engine ? <Chip>engine: {c.engine}</Chip> : null}
						{c.consentAt ? (
							<Chip tone="green">
								Consent ✓ {new Date(c.consentAt).toLocaleDateString("en-US")}
							</Chip>
						) : (
							<Chip tone="amber">Consent not recorded</Chip>
						)}
						{c.status === "live" ? <Chip tone="amber">in progress</Chip> : null}
						{history && history.count > 0 ? (
							<Chip>
								{history.count} previous consultation{history.count === 1 ? "" : "s"}
							</Chip>
						) : null}
					</div>
				</div>
				{c.anamnesis ? (
					<div className="flex gap-2">
						<Button type="button" variant="outline" onClick={copy}>
							Copy
						</Button>
						<a href={`/api/consultations/${c.id}/pdf`} download className={buttonVariants()}>
							<DownloadIcon className="mr-1.5 inline size-4 -translate-y-px" />
							Download PDF
						</a>
					</div>
				) : null}
			</header>

			{history && history.count > 0 ? (
				<details className="mt-4 rounded-2xl border border-border bg-card shadow-sm">
					<summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
						{HISTORY_SECTION_LABEL} · {history.count} previous consultation
						{history.count === 1 ? "" : "s"}
					</summary>
					<ul className="space-y-2 border-t border-border px-5 py-3 text-sm">
						{history.visits.map((v) => (
							<li key={v.id}>
								<span className="text-muted-foreground">
									{new Date(v.date).toLocaleDateString("en-US", { dateStyle: "medium" })} ·
									consultation #{v.id}
								</span>
								{v.chiefComplaint ? <div>Complaint: {v.chiefComplaint}</div> : null}
								{v.plan ? <div>Plan: {v.plan}</div> : null}
							</li>
						))}
					</ul>
					<p className="px-5 pb-3 text-[11px] text-muted-foreground">
						Factual record of prior consultations — context only, not clinical suggestions.
					</p>
				</details>
			) : null}

			<div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
				{/* ---------- anamnesis ---------- */}
				<section>
					<h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
						Anamnesis
					</h2>
					{c.anamnesis ? (
						<div className="grid gap-3 sm:grid-cols-2">
							{(Object.keys(SECTION_LABELS) as AnamnesisSectionKey[]).map((key) => {
								const sec = c.anamnesis?.[key];
								if (!sec) return null;
								const pending = sec.content.startsWith("A preencher pelo médico");
								return (
									<div
										key={key}
										className={`rounded-2xl border border-l-4 border-border bg-card p-4 shadow-sm ${CONF_BAR[sec.confidence]} ${
											WIDE.includes(key) ? "sm:col-span-2" : ""
										}`}
									>
										<div className="flex items-center justify-between gap-2">
											<h3 className="text-sm font-semibold">{SECTION_LABELS[key]}</h3>
											<span
												className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${CONF_STYLE[sec.confidence]}`}
											>
												{CONFIDENCE_LABELS[sec.confidence]}
											</span>
										</div>
										<p
											className={`mt-2 text-sm leading-relaxed whitespace-pre-wrap ${
												pending ? "text-amber-700 italic" : "text-foreground"
											}`}
										>
											{sec.content || "Not reported"}
										</p>
										{sec.evidence.length ? (
											<details className="mt-2">
												<summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
													evidence ({sec.evidence.length})
												</summary>
												<ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
													{sec.evidence.map((ev) => (
														<li key={ev.slice(0, 40)}>“{ev}”</li>
													))}
												</ul>
											</details>
										) : null}
									</div>
								);
							})}
						</div>
					) : (
						<Empty className="border bg-card px-6 py-14">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ClipboardListIcon />
								</EmptyMedia>
								<EmptyTitle>No anamnesis saved</EmptyTitle>
								<EmptyDescription>
									This consultation does not have a saved anamnesis yet.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</section>

				{/* ---------- side: transcript ---------- */}
				<aside className="rounded-2xl border border-border bg-card shadow-sm lg:sticky lg:top-20">
					<div className="border-b border-border px-5 py-3">
						<h2 className="text-sm font-semibold">Transcript</h2>
					</div>
					<div className="max-h-[70vh] overflow-y-auto p-5">
						<AudioTranscriptPanel
							consultationId={c.id}
							audioStatus={v.audioStatus}
							hasAudio={Boolean(v.audioKey)}
							browserText={v.transcript}
							serverText={v.serverTranscript}
							correctedText={v.correctedTranscript}
						/>
					</div>
				</aside>
			</div>
			<Toast toast={toast} onClose={() => setToast(null)} />
		</div>
	);
}
