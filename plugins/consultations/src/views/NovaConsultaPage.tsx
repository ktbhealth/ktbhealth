import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Dialog } from "@ktbhealth/ui/components/app-dialog";
import { Toast, type ToastData } from "@ktbhealth/ui/components/app-toast";
import { ReviewPanel } from "@ktb/anamnesis";
import { anamnesisToText } from "@ktb/anamnesis";
import { type Anamnesis, SECTION_LABELS } from "@ktb/anamnesis";
import type { AnamnesisReview, AnamnesisSectionKey, Confidence } from "@ktb/anamnesis";
import { SAMPLE_TRANSCRIPT } from "@ktb/anamnesis";
import type { Transcriber, TranscriptionBackend } from "@ktb/transcription";

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

const CONF_LABEL: Record<Confidence, string> = {
	alta: "confiança alta",
	media: "confiança média",
	baixa: "confiança baixa",
};

function fmtElapsed(totalSec: number) {
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function Step({ n, label, done }: { n: number; label: string; done: boolean }) {
	return (
		<span className="flex items-center gap-2">
			<span
				className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
					done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
				}`}
			>
				{done ? "✓" : n}
			</span>
			<span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
		</span>
	);
}

export interface NovaApi {
	getLiveConsultation(input: { data: number }): Promise<{
		transcript: string;
		status: string | null;
	} | null>;
	extractAnamnese(input: { data: string }): Promise<{ anamnesis: Anamnesis; engine: string }>;
	reviewAnamnese(input: { data: { transcript: string; anamnesis: Anamnesis } }): Promise<{
		review?: AnamnesisReview | null;
		engine?: string | null;
		ok?: boolean;
		reason?: string;
	}>;
	attachAnamnesis(input: {
		data: {
			consultationId: number;
			anamnesis: Anamnesis;
			engine: string;
			patientId?: number;
			review?: AnamnesisReview | null;
		};
	}): Promise<{ ok: boolean }>;
	saveConsultation(input: { data: unknown }): Promise<{ id: number; updated?: boolean }>;
	recordConsent(input: { data: number }): Promise<{ ok: boolean }>;
	createPatient(input: { data: string }): Promise<{ id: number; name: string } | null>;
}

export function NovaConsultaPage({
	initialPatients,
	api,
	backend,
}: {
	initialPatients: Array<{ id: number; name: string }>;
	api: NovaApi;
	backend: TranscriptionBackend;
}) {
	const [recording, setRecording] = useState(false);
	const [supported] = useState(() => backend.mic().supported);
	const [transcript, setTranscript] = useState("");
	const [partial, setPartial] = useState("");
	const [anamnesis, setAnamnesis] = useState<Anamnesis | null>(null);
	const [engine, setEngine] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [review, setReview] = useState<AnamnesisReview | null>(null);
	const [reviewBusy, setReviewBusy] = useState(false);
	const [reviewNote, setReviewNote] = useState<string | null>(null);
	const [reviewEngine, setReviewEngine] = useState<string | null>(null);
	const [savedId, setSavedId] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveDialog, setSaveDialog] = useState<
		{ kind: "ok"; id: number; updated: boolean } | { kind: "error"; message: string } | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const [meetUrl, setMeetUrl] = useState("");
	const [liveId, setLiveId] = useState<number | null>(null);
	const [liveStatus, setLiveStatus] = useState<string | null>(null);
	const [consented, setConsented] = useState(false);
	const [patientId, setPatientId] = useState<number | null>(null);
	const [patientName, setPatientName] = useState("");
	const [patients, setPatients] = useState<Array<{ id: number; name: string }>>(() =>
		initialPatients.map((p: { id: number; name: string }) => ({
			id: p.id,
			name: p.name,
		})),
	);
	const transcriberRef = useRef<Transcriber | null>(null);
	const tabRef = useRef<Transcriber | null>(null);
	const [tabRecording, setTabRecording] = useState(false);
	const [modelStatus, setModelStatus] = useState<string | null>(() => {
		const st = backend.status();
		return st.state === "ready" ? `modelo pronto — ${st.device}` : null;
	});
	const [toast, setToast] = useState<ToastData | null>(null);
	const [source, setSource] = useState<"gravar" | "bot" | "upload">("gravar");
	const [resultTab, setResultTab] = useState<"anamnese" | "review">("anamnese");
	const [mode, setMode] = useState<"live" | "dictation">("live");
	const [dictating, setDictating] = useState(false);
	const [elapsedSec, setElapsedSec] = useState(0);
	const dictationStartRef = useRef(0);

	// Preload Whisper once per page: first visit downloads, later ones
	// come straight from the browser cache.
	useEffect(() => {
		const off = backend.subscribe((m) => {
			if (m.type === "progress") setModelStatus(m.message ?? null);
			if (m.type === "ready") setModelStatus(`modelo pronto — ${m.device}`);
			if (m.type === "error" && !m.id) setModelStatus(`modelo indisponível: ${m.message}`);
		});
		backend.load();
		return off;
	}, []);

	useEffect(() => {
		const t = backend.mic();
		transcriberRef.current = t;
		tabRef.current = backend.tab();
		return () => {
			t.stop();
			tabRef.current?.stop();
		};
	}, []);

	// elapsed clock while dictating
	useEffect(() => {
		if (!dictating) return;
		const i = setInterval(
			() => setElapsedSec(Math.floor((Date.now() - dictationStartRef.current) / 1000)),
			500,
		);
		return () => clearInterval(i);
	}, [dictating]);

	// Poll a live bot consultation — transcript grows as events arrive.
	useEffect(() => {
		if (!liveId || liveStatus === "done") return;
		const interval = setInterval(async () => {
			const res = await api.getLiveConsultation({ data: liveId });
			if (!res) return;
			setTranscript(res.transcript);
			setLiveStatus(res.status);
		}, 1500);
		return () => clearInterval(interval);
	}, [liveId, liveStatus]);

	async function uploadAudio(file: File) {
		setBusy(true);
		setError(null);
		try {
			const form = new FormData();
			form.append("audio", file);
			const res = await fetch("/api/transcribe", { method: "POST", body: form });
			if (!res.ok) throw new Error(`transcrição falhou (${res.status})`);
			const { text } = (await res.json()) as { text: string };
			setTranscript((t) => (t ? `${t}\n${text}` : text));
		} catch (e) {
			setError(e instanceof Error ? e.message : "transcrição falhou");
		} finally {
			setBusy(false);
		}
	}

	async function sendBot() {
		/* v8 ignore next -- Enviar bot is disabled while meetUrl is empty */
		if (!meetUrl.trim()) return;
		setError(null);
		setSavedId(null);
		const res = await fetch("/api/bots", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ meetUrl }),
		});
		const data = (await res.json()) as {
			consultationId?: number;
			provider?: string;
			error?: string;
		};
		if (!res.ok || !data.consultationId) {
			setError(data.error ?? `bot falhou: HTTP ${res.status}`);
			return;
		}
		setLiveId(data.consultationId);
		setLiveStatus("live");
	}

	function toggleRecording() {
		const t = transcriberRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any click */
		if (!t) return;
		if (recording) {
			t.stop();
			setRecording(false);
			return;
		}
		setError(null);
		t.start((ev) => {
			if (ev.type === "partial") setPartial(ev.text);
			if (ev.type === "final") {
				setTranscript((prev) => `${prev}${prev ? "\n" : ""}Médico: ${ev.text}`);
				setPartial("");
			}
			if (ev.type === "error") {
				setError(ev.message);
				setRecording(false);
			}
			if (ev.type === "end") {
				setRecording(false);
				setPartial("");
			}
		});
		setRecording(true);
	}

	function toggleTabCapture() {
		const t = tabRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any click */
		if (!t) return;
		if (tabRecording) {
			t.stop();
			setTabRecording(false);
			return;
		}
		setError(null);
		t.start((ev) => {
			if (ev.type === "partial") setPartial(ev.text);
			if (ev.type === "final") {
				setTranscript((prev) => `${prev}${prev ? "\n" : ""}Paciente: ${ev.text}`);
				setPartial("");
			}
			if (ev.type === "error") {
				setError(ev.message);
				setTabRecording(false);
			}
			if (ev.type === "end") {
				setTabRecording(false);
				setPartial("");
			}
		});
		setTabRecording(true);
	}

	/**
	 * Ditado pós-consulta: same mic transcriber (Whisper), single speaker —
	 * finals land in the transcript without a "Médico:" prefix since the
	 * narration already describes the whole consultation.
	 */
	function toggleDictation() {
		const t = transcriberRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any click */
		if (!t) return;
		if (dictating) {
			t.stop();
			setDictating(false);
			return;
		}
		setError(null);
		dictationStartRef.current = Date.now();
		setElapsedSec(0);
		t.start((ev) => {
			if (ev.type === "partial") setPartial(ev.text);
			if (ev.type === "final") {
				setTranscript((prev) => `${prev}${prev ? "\n" : ""}${ev.text}`);
				setPartial("");
			}
			if (ev.type === "error") {
				setError(ev.message);
				setDictating(false);
			}
			if (ev.type === "end") {
				setDictating(false);
				setPartial("");
			}
		});
		setDictating(true);
	}

	async function generate() {
		/* v8 ignore next -- Gerar anamnese is disabled while transcript is empty */
		if (!transcript.trim()) return;
		setBusy(true);
		setError(null);
		setSavedId(null);
		try {
			setReview(null);
			setReviewNote(null);
			setResultTab("anamnese");
			const res = await api.extractAnamnese({ data: transcript });
			setAnamnesis(res.anamnesis);
			setEngine(res.engine);
			// second opinion runs in the background — anamnese shows first
			void runReview(transcript, res.anamnesis);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function runReview(t: string, a: Anamnesis) {
		setReviewBusy(true);
		try {
			const r = await api.reviewAnamnese({
				data: { transcript: t, anamnesis: a },
			});
			if (r.review) {
				setReview(r.review);
				setReviewEngine("engine" in r ? (r.engine ?? null) : null);
			} else {
				setReviewNote("reason" in r ? String(r.reason) : "Segunda opinião indisponível.");
			}
		} catch (e) {
			setReviewNote(e instanceof Error ? e.message : String(e));
		} finally {
			setReviewBusy(false);
		}
	}

	function showToast(t: Omit<ToastData, "id">) {
		setToast({ id: Date.now(), ...t });
	}

	/** Returns true when added, false when it was already in the section. */
	function addHypothesis(text: string): boolean {
		/* v8 ignore next -- ReviewPanel only renders when anamnesis exists */
		if (!anamnesis) return false;
		const cur = anamnesis.hipoteses.content;
		if (cur.includes(text)) {
			showToast({ text: "Essa hipótese já está na anamnese" });
			return false;
		}
		const empty = !cur.trim() || cur.startsWith("A preencher pelo médico");
		setAnamnesis({
			...anamnesis,
			hipoteses: {
				...anamnesis.hipoteses,
				content: empty ? `- ${text}` : `${cur}\n- ${text}`,
			},
		});
		showToast({
			text: "Hipótese adicionada à anamnese",
			actionLabel: "Ver",
			onAction: () => {
				setResultTab("anamnese");
				// wait for the tab to render, then focus the section
				setTimeout(() => {
					const el = document.getElementById("sec-hipoteses");
					el?.scrollIntoView({ behavior: "smooth", block: "center" });
					el?.focus();
				}, 50);
			},
		});
		return true;
	}

	async function save() {
		/* v8 ignore next -- save button only renders with anamnesis and is disabled while saving */
		if (!anamnesis || saving) return;
		setSaving(true);
		try {
			// a consultation already saved/live is updated, never duplicated
			const existing = liveId ?? savedId;
			let id: number | null = existing;
			if (existing) {
				const r = await api.attachAnamnesis({
					data: {
						consultationId: existing,
						anamnesis,
						engine: engine ?? "unknown",
						patientId: patientId ?? undefined,
						review,
					},
				});
				if (!r.ok) throw new Error("sessão expirada — recarregue a página");
			} else {
				const res = await api.saveConsultation({
					data: {
						transcript,
						anamnesis,
						engine: engine ?? "unknown",
						patientId: patientId ?? undefined,
						review,
					},
				});
				id = res.id ?? null;
			}
			if (!id) throw new Error("não foi possível salvar a consulta");
			if (consented) await api.recordConsent({ data: id });
			setSavedId(id);
			setSaveDialog({ kind: "ok", id, updated: Boolean(existing) });
		} catch (e) {
			setSaveDialog({
				kind: "error",
				message: e instanceof Error ? e.message : String(e),
			});
		} finally {
			setSaving(false);
		}
	}

	function updateSection(key: AnamnesisSectionKey, content: string) {
		setAnamnesis((a) =>
			a
				? { ...a, [key]: { ...a[key], content } }
				: /* v8 ignore next -- textarea only exists with anamnesis */ a,
		);
	}

	function copyAnamnesis() {
		/* v8 ignore next -- Copiar button only renders with anamnesis */
		if (!anamnesis) return;
		const text = anamnesisToText(anamnesis);
		void navigator.clipboard.writeText(text).then(
			() => showToast({ text: "Anamnese copiada para a área de transferência" }),
			() => setError("Não foi possível copiar — selecione o texto manualmente."),
		);
	}

	const step1 = consented && (patientId !== null || patients.length === 0);
	const step2 = transcript.trim().length > 0;
	const step3 = anamnesis !== null;
	const live = recording || tabRecording || dictating;
	/* v8 ignore next -- patientId only comes from the patients list or createPatient */
	const dialogPatientName = patientId
		? (patients.find((p) => p.id === patientId)?.name ?? "paciente")
		: null;

	const cardCls = "rounded-2xl border border-border bg-card shadow-sm";
	const btnPrimary =
		"rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-40";
	const btnGhost =
		"rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

	return (
		<div>
			{/* ---- cabeçalho + progresso ---- */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Nova consulta</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Grave a conversa ou cole a transcrição — a anamnese sai estruturada para revisão.
					</p>
				</div>
				<div className="flex items-center gap-3 text-sm">
					<Step n={1} label="Preparar" done={step1} />
					<span className="h-px w-6 bg-border" />
					<Step n={2} label="Transcrever" done={step2} />
					<span className="h-px w-6 bg-border" />
					<Step n={3} label="Revisar" done={step3} />
				</div>
			</div>

			{/* ---- modo: consulta ao vivo vs ditado pós-consulta ---- */}
			<div
				className="mt-4 flex w-fit items-center gap-1 rounded-lg bg-muted p-0.5 text-sm"
				role="tablist"
				aria-label="Modo da consulta"
			>
				{(
					[
						["live", "Consulta ao vivo"],
						["dictation", "Ditado pós-consulta"],
					] as const
				).map(([key, label]) => (
					<button
						key={key}
						type="button"
						role="tab"
						aria-selected={mode === key}
						disabled={live}
						onClick={() => setMode(key)}
						className={`rounded-md px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
							mode === key
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{label}
					</button>
				))}
			</div>

			{/* ---- 1. preparar: paciente + consentimento ---- */}
			<section className={`${cardCls} mt-6 p-4`}>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
					<div className="flex items-center gap-2">
						<label
							className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
							htmlFor="patient-sel"
						>
							Paciente
						</label>
						<select
							id="patient-sel"
							value={patientId ?? ""}
							onChange={(e) => setPatientId(e.target.value ? Number(e.target.value) : null)}
							className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm"
						>
							<option value="">sem vínculo</option>
							{patients.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</select>
					</div>
					<div className="flex items-center gap-2">
						<input
							value={patientName}
							onChange={(e) => setPatientName(e.target.value)}
							placeholder="novo paciente"
							aria-label="Nome do novo paciente"
							className="w-40 rounded-lg border border-border px-2.5 py-1.5 text-sm"
						/>
						<button
							type="button"
							onClick={async () => {
								if (!patientName.trim()) return;
								const p = await api.createPatient({ data: patientName });
								if (p) {
									setPatients((prev) => [...prev, { id: p.id, name: p.name }]);
									setPatientId(p.id);
									setPatientName("");
								}
							}}
							className={btnGhost}
						>
							+ paciente
						</button>
					</div>
					<label
						className={`ml-auto flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs ${
							consented
								? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
								: "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
						}`}
					>
						<input
							type="checkbox"
							checked={consented}
							onChange={(e) => setConsented(e.target.checked)}
						/>
						Declaro que o paciente foi informado e consentiu com a gravação
					</label>
				</div>
			</section>

			<div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
				{/* ================= coluna esquerda: transcrição ================= */}
				<section className={cardCls}>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<h2 className="font-semibold">Transcrição</h2>
						{mode === "live" ? (
							<div className="flex rounded-lg bg-muted p-0.5 text-xs" role="tablist">
								{(
									[
										["gravar", "Gravar"],
										["upload", "Upload"],
										["bot", "Teleconsulta (bot)"],
									] as const
								).map(([key, label]) => (
									<button
										key={key}
										type="button"
										role="tab"
										aria-selected={source === key}
										onClick={() => setSource(key)}
										className={`rounded-md px-3 py-1 font-medium transition ${
											source === key
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground"
										}`}
									>
										{label}
									</button>
								))}
							</div>
						) : null}
					</div>

					<div className="space-y-4 p-5">
						{mode === "dictation" ? (
							<div className="flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-8 text-center">
								<p className="max-w-md text-sm text-muted-foreground">
									A consulta já aconteceu? Narre tudo em voz alta, como se explicasse o caso — uma
									voz só (a sua): queixa, história, exame e conduta. A narração vira a transcrição
									que gera a anamnese.
								</p>
								<button
									type="button"
									onClick={toggleDictation}
									disabled={!supported || !consented}
									className={`flex items-center gap-3 rounded-full px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
										dictating
											? "bg-red-600 text-white hover:bg-red-700"
											: "bg-primary text-primary-foreground hover:bg-primary/80"
									}`}
								>
									<span
										className={`size-3 rounded-full ${dictating ? "animate-pulse bg-white" : "bg-white/70"}`}
									/>
									{dictating ? `Parar narração — ${fmtElapsed(elapsedSec)}` : "Iniciar narração"}
								</button>
								{dictating ? (
									<p className="text-xs text-muted-foreground">
										gravando… {fmtElapsed(elapsedSec)} — a transcrição aparece abaixo em tempo real
									</p>
								) : null}
								{!consented ? (
									<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
										Marque o consentimento acima para liberar a narração.
									</p>
								) : null}
								{!supported ? (
									<p className="text-xs text-amber-600">
										Gravação não suportada neste browser — use o exemplo ou cole o texto
										(Chrome/Edge suportam).
									</p>
								) : null}
							</div>
						) : source === "upload" ? (
							<label className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground transition hover:border-foreground/20">
								<input
									type="file"
									accept="audio/*"
									className="hidden"
									disabled={busy}
									onChange={(e) => {
										const f = e.target.files?.[0];
										if (f) void uploadAudio(f);
										e.target.value = "";
									}}
								/>
								<span className="font-medium text-foreground">
									{busy ? "Transcrevendo…" : "Enviar gravação"}
								</span>
								<span className="text-[11px]">Áudio transcrito no servidor (Whisper)</span>
							</label>
						) : source === "gravar" ? (
							<>
								<div className="grid gap-3 sm:grid-cols-2">
									<button
										type="button"
										onClick={toggleRecording}
										disabled={!supported || !consented}
										className={`flex flex-col items-start rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
											recording
												? "border-red-300 bg-red-50"
												: "border-border hover:border-foreground/20"
										}`}
									>
										<span className="flex items-center gap-2 text-sm font-medium">
											{recording ? (
												<span className="size-2.5 animate-pulse rounded-full bg-red-600" />
											) : (
												<span className="size-2.5 rounded-full bg-muted-foreground" />
											)}
											{recording ? "Parar microfone" : "Gravar microfone"}
										</span>
										<span className="mt-1 text-[11px] text-muted-foreground">
											Sua voz — aparece como “Médico”
										</span>
									</button>
									<button
										type="button"
										onClick={toggleTabCapture}
										disabled={!consented}
										className={`flex flex-col items-start rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
											tabRecording
												? "border-red-300 bg-red-50"
												: "border-border hover:border-foreground/20"
										}`}
									>
										<span className="flex items-center gap-2 text-sm font-medium">
											{tabRecording ? (
												<span className="size-2.5 animate-pulse rounded-full bg-red-600" />
											) : (
												<span className="size-2.5 rounded-full bg-muted-foreground" />
											)}
											{tabRecording ? "Parar aba" : "Capturar aba da chamada"}
										</span>
										<span className="mt-1 text-[11px] text-muted-foreground">
											Áudio da call — aparece como “Paciente”
										</span>
									</button>
								</div>
								{!consented ? (
									<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
										Marque o consentimento acima para liberar a gravação.
									</p>
								) : (
									<p className="text-[11px] text-muted-foreground">
										Dica: ligue os dois para separar médico e paciente, e use fone de ouvido para o
										microfone não captar a caixa de som.
									</p>
								)}
								{!supported ? (
									<p className="text-xs text-amber-600">
										Gravação não suportada neste browser — use o exemplo ou cole o texto
										(Chrome/Edge suportam).
									</p>
								) : null}
							</>
						) : (
							<div>
								<div className="flex items-center gap-2">
									<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
										speaker labels grátis via canais
									</span>
								</div>
								<p className="mt-2 text-xs text-muted-foreground">
									O bot “Anamnese” entra na sua call (Meet/Zoom/Teams), transcreve com separação por
									falante e gera o rascunho quando a consulta acaba.
								</p>
								<div className="mt-3 flex gap-2">
									<input
										type="url"
										value={meetUrl}
										onChange={(e) => setMeetUrl(e.target.value)}
										aria-label="Link da teleconsulta"
										placeholder="https://meet.google.com/xxx-xxxx-xxx"
										className="w-full rounded-lg border border-border px-3 py-2 text-sm"
									/>
									<button
										type="button"
										onClick={sendBot}
										disabled={!meetUrl.trim() || liveStatus === "live"}
										className={`${btnPrimary} shrink-0`}
									>
										{liveStatus === "live" ? "bot na call…" : "Enviar bot"}
									</button>
								</div>
								{liveId ? (
									<p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
										{liveStatus === "live" ? (
											<span className="size-2 animate-pulse rounded-full bg-red-600" />
										) : (
											<span className="size-2 rounded-full bg-emerald-500" />
										)}
										consulta #{liveId} —{" "}
										{liveStatus === "live" ? "transcrevendo ao vivo" : "call encerrada"}
									</p>
								) : null}
							</div>
						)}

						{/* estado: modelo / gravação / parcial */}
						<div className="flex flex-wrap items-center gap-2 text-xs">
							{modelStatus ? (
								<span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
									🧠 {modelStatus}
								</span>
							) : null}
							{live ? (
								<span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-red-700">
									<span className="size-2 animate-pulse rounded-full bg-red-600" />
									gravando… fale normalmente
								</span>
							) : null}
						</div>
						{partial ? (
							<p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground italic">
								{partial}…
							</p>
						) : null}

						<div>
							<div className="mb-1.5 flex items-center justify-between">
								<label
									htmlFor="transcript"
									className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
								>
									Texto da consulta
								</label>
								<div className="flex gap-2">
									<button
										type="button"
										onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
										className={btnGhost}
									>
										Usar exemplo
									</button>
									<button
										type="button"
										onClick={() => setTranscript("")}
										disabled={!transcript}
										className={btnGhost}
									>
										Limpar
									</button>
								</div>
							</div>
							<textarea
								id="transcript"
								value={transcript}
								onChange={(e) => setTranscript(e.target.value)}
								rows={14}
								placeholder="A transcrição aparece aqui (ou cole o texto da consulta)"
								className="w-full resize-y rounded-xl border border-border px-3 py-2.5 font-mono text-sm leading-relaxed"
							/>
						</div>

						<button
							type="button"
							onClick={generate}
							disabled={busy || !transcript.trim()}
							className={`${btnPrimary} w-full py-2.5`}
						>
							{busy ? "Gerando anamnese…" : "Gerar anamnese →"}
						</button>
						{error ? (
							<p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
						) : null}
					</div>
				</section>

				{/* ================= coluna direita: resultado ================= */}
				<section className={`${cardCls} lg:sticky lg:top-4`}>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<div className="flex gap-1 text-sm" role="tablist">
							<button
								type="button"
								role="tab"
								aria-selected={resultTab === "anamnese"}
								onClick={() => setResultTab("anamnese")}
								className={`rounded-lg px-3 py-1.5 font-medium transition ${
									resultTab === "anamnese"
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-muted"
								}`}
							>
								Anamnese
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={resultTab === "review"}
								onClick={() => setResultTab("review")}
								disabled={!anamnesis}
								className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition disabled:opacity-40 ${
									resultTab === "review"
										? "bg-indigo-600 text-white"
										: "text-muted-foreground hover:bg-muted"
								}`}
							>
								Segunda opinião
								{reviewBusy ? (
									<span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
								) : review ? (
									<span
										className={`rounded-full px-1.5 text-[10px] ${
											resultTab === "review" ? "bg-white/25" : "bg-indigo-100 text-indigo-700"
										}`}
									>
										{review.hipoteses.length + review.lacunas.length}
									</span>
								) : null}
							</button>
						</div>
						{resultTab === "anamnese" && engine ? (
							<span className="text-[11px] text-muted-foreground">engine: {engine}</span>
						) : null}
						{resultTab === "review" && reviewEngine ? (
							<span className="text-[11px] text-muted-foreground">{reviewEngine}</span>
						) : null}
					</div>

					{!anamnesis ? (
						<div className="px-5 py-14 text-center">
							<div className="text-3xl">📋</div>
							<p className="mx-auto mt-3 max-w-xs text-sm text-muted-foreground">
								A anamnese estruturada aparece aqui. Cada seção mostra a confiança e as frases-fonte
								que a fundamentam.
							</p>
						</div>
					) : resultTab === "anamnese" ? (
						<div className="max-h-[68vh] space-y-3 overflow-y-auto p-5">
							{(Object.keys(SECTION_LABELS) as AnamnesisSectionKey[]).map((key) => {
								const sec = anamnesis[key];
								return (
									<div
										key={key}
										className={`rounded-xl border border-l-4 border-border bg-card p-3 ${CONF_BAR[sec.confidence]}`}
									>
										<div className="flex items-center justify-between gap-2">
											<label
												htmlFor={`sec-${key}`}
												className="text-xs font-semibold text-foreground"
											>
												{SECTION_LABELS[key]}
											</label>
											<span
												className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${CONF_STYLE[sec.confidence]}`}
											>
												{CONF_LABEL[sec.confidence]}
											</span>
										</div>
										<textarea
											id={`sec-${key}`}
											value={sec.content}
											onChange={(e) => updateSection(key, e.target.value)}
											rows={Math.min(5, Math.max(2, Math.ceil(sec.content.length / 70)))}
											className="mt-1.5 w-full resize-y rounded-lg border border-border px-2.5 py-2 text-sm leading-relaxed"
										/>
										{sec.evidence.length ? (
											<details className="mt-1">
												<summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-muted-foreground">
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
						<div className="max-h-[68vh] overflow-y-auto p-5">
							<p className="mb-4 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-900">
								Apoio à decisão — sugestões para o médico avaliar. Não fazem parte do prontuário até
								você adicionar.
							</p>
							{reviewBusy ? (
								<p className="py-10 text-center text-sm text-muted-foreground">
									analisando lacunas e hipóteses…
									<span className="mt-1 block text-xs text-muted-foreground">
										modelos locais podem levar mais de um minuto
									</span>
								</p>
							) : review ? (
								<ReviewPanel review={review} onAddHypothesis={addHypothesis} />
							) : reviewNote ? (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
									{reviewNote}
								</p>
							) : null}
						</div>
					)}

					{anamnesis ? (
						<div className="flex items-center gap-2 border-t border-border px-5 py-3">
							<button type="button" onClick={copyAnamnesis} className={btnGhost}>
								Copiar
							</button>
							<button type="button" onClick={save} disabled={saving} className={btnPrimary}>
								{saving ? "Salvando…" : savedId ? "Atualizar consulta" : "Salvar consulta"}
							</button>
						</div>
					) : null}
				</section>
			</div>
			<Toast toast={toast} onClose={() => setToast(null)} />
			<Dialog
				open={saveDialog !== null}
				onClose={() => setSaveDialog(null)}
				tone={saveDialog?.kind === "error" ? "error" : "success"}
				title={
					saveDialog?.kind === "error"
						? "Não foi possível salvar"
						: saveDialog?.updated
							? "Consulta atualizada"
							: "Anamnese salva com sucesso"
				}
				actions={
					saveDialog?.kind === "ok" ? (
						<>
							<a href={`/api/consultas/${saveDialog.id}/pdf`} download className={btnGhost}>
								⬇ Baixar PDF
							</a>
							<Link to="/consultas/$id" params={{ id: String(saveDialog.id) }} className={btnGhost}>
								Ver consulta
							</Link>
							<button type="button" onClick={() => setSaveDialog(null)} className={btnPrimary}>
								Confirmar
							</button>
						</>
					) : (
						<button type="button" onClick={() => setSaveDialog(null)} className={btnPrimary}>
							Entendi
						</button>
					)
				}
			>
				{saveDialog?.kind === "ok" ? (
					<p>
						A consulta <strong>#{saveDialog.id}</strong>
						{patientId ? ` de ${dialogPatientName}` : ""} foi{" "}
						{saveDialog.updated ? "atualizada" : "gravada"} com a anamnese revisada
						{review ? " e a segunda opinião" : ""}.
						{consented ? " Consentimento do paciente registrado." : ""}
					</p>
				) : (
					<p>{saveDialog?.kind === "error" ? saveDialog.message : ""}</p>
				)}
			</Dialog>
		</div>
	);
}
