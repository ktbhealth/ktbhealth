import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardListIcon, DownloadIcon } from "lucide-react";

import { anamnesisToText } from "@ktb/anamnesis";
import { CONFIDENCE_LABELS, HISTORY_SECTION_LABEL, SECTION_LABELS } from "@ktb/anamnesis";
import type { Anamnesis, AnamnesisSectionKey, Confidence, PatientHistory } from "@ktb/anamnesis";
import { Toast, type ToastData } from "@ktbhealth/ui/components/app-toast";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";

const CONF_STYLE: Record<Confidence, string> = {
	alta: "bg-primary/10 text-primary ring-primary/20",
	media: "bg-amber-50 text-amber-700 ring-amber-200",
	baixa: "bg-muted text-muted-foreground ring-border",
};

const CONF_BAR: Record<Confidence, string> = {
	alta: "border-l-primary",
	media: "border-l-amber-400",
	baixa: "border-l-border",
};

/** Sections that read better side by side. */
const WIDE: AnamnesisSectionKey[] = ["queixa_principal", "hda", "hipoteses", "conduta"];

const SOURCE_LABEL: Record<string, string> = {
	browser: "Browser voice",
	bot: "Teleconsult (bot)",
	dictation: "Dictation",
	upload: "Upload",
};

const SPEAKER_STYLE: Record<string, string> = {
	Doctor: "bg-sky-50 text-sky-800 ring-sky-200",
	Patient: "bg-primary/10 text-primary ring-primary/20",
	// legacy pt-BR speaker labels from bot/dictation transcripts
	Médico: "bg-sky-50 text-sky-800 ring-sky-200",
	Paciente: "bg-primary/10 text-primary ring-primary/20",
};

function Chip({
	children,
	tone = "neutral",
}: {
	children: React.ReactNode;
	tone?: "neutral" | "green" | "amber";
}) {
	const tones = {
		neutral: "bg-muted text-muted-foreground ring-border",
		green: "bg-primary/10 text-primary ring-primary/20",
		amber: "bg-amber-50 text-amber-700 ring-amber-200",
	};
	return (
		<span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>
			{children}
		</span>
	);
}

/** "Doctor: text" lines become chat-style bubbles. */
function Transcript({ text }: { text: string }) {
	const lines = text.split("\n").filter((l) => l.trim());
	if (!lines.length) return <p className="text-sm text-muted-foreground">No transcript.</p>;
	return (
		<div className="space-y-2.5">
			{lines.map((line, i) => {
				const m = line.match(/^([\p{L} ]{2,20}):\s*(.*)$/u);
				const speaker = m?.[1];
				const body = m ? m[2] : line;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static, ordered transcript lines
						key={i}
						className="text-sm leading-relaxed"
					>
						{speaker ? (
							<span
								className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
									SPEAKER_STYLE[speaker] ?? "bg-muted text-muted-foreground ring-border"
								}`}
							>
								{speaker}
							</span>
						) : null}
						<span className="text-foreground">{body}</span>
					</div>
				);
			})}
		</div>
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
}

export function ConsultationDetailPage({
	c,
	history,
}: {
	c: ConsultationDetail;
	history: PatientHistory | null;
}) {
	const [toast, setToast] = useState<ToastData | null>(null);
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
			<Link to="/consultations" className="text-sm text-muted-foreground hover:text-foreground">
				← Consultations
			</Link>

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
						<button
							type="button"
							onClick={copy}
							className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
						>
							Copy
						</button>
						<a
							href={`/api/consultations/${c.id}/pdf`}
							download
							className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/80"
						>
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
						<Transcript text={c.transcript} />
					</div>
				</aside>
			</div>
			<Toast toast={toast} onClose={() => setToast(null)} />
		</div>
	);
}
