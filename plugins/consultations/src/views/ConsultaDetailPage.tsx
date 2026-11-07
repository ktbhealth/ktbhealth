import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardListIcon, DownloadIcon } from "lucide-react";

import { ReviewPanel } from "@ktb/anamnesis";
import { anamnesisToText } from "@ktb/anamnesis";
import { SECTION_LABELS } from "@ktb/anamnesis";
import type { Anamnesis, AnamnesisReview, AnamnesisSectionKey, Confidence } from "@ktb/anamnesis";
import { Toast, type ToastData } from "@ktbhealth/ui/components/app-toast";

const CONF_STYLE: Record<Confidence, string> = {
	alta: "bg-emerald-50 text-emerald-700 ring-emerald-200",
	media: "bg-amber-50 text-amber-700 ring-amber-200",
	baixa: "bg-muted text-muted-foreground ring-border",
};

const CONF_BAR: Record<Confidence, string> = {
	alta: "border-l-emerald-400",
	media: "border-l-amber-400",
	baixa: "border-l-border",
};

/** Sections that read better side by side. */
const WIDE: AnamnesisSectionKey[] = ["queixa_principal", "hda", "hipoteses", "conduta"];

const SOURCE_LABEL: Record<string, string> = {
	browser: "Voz no navegador",
	bot: "Teleconsulta (bot)",
	dictation: "Ditado",
	upload: "Upload",
};

const SPEAKER_STYLE: Record<string, string> = {
	Médico: "bg-sky-50 text-sky-800 ring-sky-200",
	Paciente: "bg-emerald-50 text-emerald-800 ring-emerald-200",
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
		green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
		amber: "bg-amber-50 text-amber-700 ring-amber-200",
	};
	return (
		<span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>
			{children}
		</span>
	);
}

/** "Médico: texto" lines become chat-style bubbles. */
function Transcript({ text }: { text: string }) {
	const lines = text.split("\n").filter((l) => l.trim());
	if (!lines.length) return <p className="text-sm text-muted-foreground">Sem transcrição.</p>;
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

export interface ConsultaDetail {
	id: number;
	userId: string | null;
	patientId: number | null;
	transcript: string;
	anamnesis: Anamnesis | null;
	review: AnamnesisReview | null;
	engine: string | null;
	source: string | null;
	status: string;
	botId: string | null;
	consentAt: Date | null;
	createdAt: Date;
	patientName: string | null;
}

export function ConsultaDetailPage({ c }: { c: ConsultaDetail }) {
	const [tab, setTab] = useState<"review" | "transcricao">(c.review ? "review" : "transcricao");
	const [toast, setToast] = useState<ToastData | null>(null);
	const when = new Date(c.createdAt).toLocaleString("pt-BR", {
		dateStyle: "long",
		timeStyle: "short",
	});

	function copy() {
		/* v8 ignore next -- copy button only renders when anamnesis exists */
		if (!c.anamnesis) return;
		void navigator.clipboard
			.writeText(anamnesisToText(c.anamnesis))
			.then(() => setToast({ id: Date.now(), text: "Anamnese copiada" }));
	}

	return (
		<div>
			<Link to="/consultas" className="text-sm text-muted-foreground hover:text-foreground">
				← Consultas
			</Link>

			{/* ---------- cabeçalho ---------- */}
			<header className="mt-3 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">
						{c.patientName ?? `Consulta #${c.id}`}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Consulta #{c.id} · {when}
					</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						<Chip>{SOURCE_LABEL[c.source ?? ""] ?? c.source}</Chip>
						{c.engine ? <Chip>engine: {c.engine}</Chip> : null}
						{c.consentAt ? (
							<Chip tone="green">
								Consentimento ✓ {new Date(c.consentAt).toLocaleDateString("pt-BR")}
							</Chip>
						) : (
							<Chip tone="amber">Consentimento não registrado</Chip>
						)}
						{c.status === "live" ? <Chip tone="amber">em andamento</Chip> : null}
					</div>
				</div>
				{c.anamnesis ? (
					<div className="flex gap-2">
						<button
							type="button"
							onClick={copy}
							className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
						>
							Copiar
						</button>
						<a
							href={`/api/consultas/${c.id}/pdf`}
							download
							className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/80"
						>
							<DownloadIcon className="mr-1.5 inline size-4 -translate-y-px" />
							Baixar PDF
						</a>
					</div>
				) : null}
			</header>

			<div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
				{/* ---------- anamnese ---------- */}
				<section>
					<h2 className="mb-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
						Anamnese
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
												{sec.confidence}
											</span>
										</div>
										<p
											className={`mt-2 text-sm leading-relaxed whitespace-pre-wrap ${
												pending ? "text-amber-700 italic" : "text-foreground"
											}`}
										>
											{sec.content || "Não informado"}
										</p>
										{sec.evidence.length ? (
											<details className="mt-2">
												<summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
													evidência ({sec.evidence.length})
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
						<div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
							<ClipboardListIcon className="mx-auto size-8 text-muted-foreground" />
							<p className="mt-2 text-sm text-muted-foreground">
								Esta consulta ainda não tem anamnese salva.
							</p>
						</div>
					)}
				</section>

				{/* ---------- lateral: segunda opinião / transcrição ---------- */}
				<aside className="rounded-2xl border border-border bg-card shadow-sm lg:sticky lg:top-20">
					<div className="flex gap-1 border-b border-border p-2 text-sm">
						{c.review ? (
							<button
								type="button"
								onClick={() => setTab("review")}
								aria-pressed={tab === "review"}
								className={`rounded-lg px-3 py-1.5 font-medium transition ${
									tab === "review"
										? "bg-indigo-600 text-white"
										: "text-muted-foreground hover:bg-muted"
								}`}
							>
								Segunda opinião
							</button>
						) : null}
						<button
							type="button"
							onClick={() => setTab("transcricao")}
							aria-pressed={tab === "transcricao"}
							className={`rounded-lg px-3 py-1.5 font-medium transition ${
								tab === "transcricao"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:bg-muted"
							}`}
						>
							Transcrição
						</button>
					</div>
					<div className="max-h-[70vh] overflow-y-auto p-5">
						{tab === "review" && c.review ? (
							<>
								<p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-900">
									Apoio à decisão gerado por IA. Sugestões não fazem parte do prontuário.
								</p>
								<ReviewPanel review={c.review} />
							</>
						) : (
							<Transcript text={c.transcript} />
						)}
					</div>
				</aside>
			</div>
			<Toast toast={toast} onClose={() => setToast(null)} />
		</div>
	);
}
