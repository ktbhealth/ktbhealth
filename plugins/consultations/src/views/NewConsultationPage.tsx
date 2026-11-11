import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrainIcon, ClipboardListIcon, DownloadIcon } from "lucide-react";

import { Dialog } from "@ktbhealth/ui/components/app-dialog";
import { Toast, type ToastData } from "@ktbhealth/ui/components/app-toast";
import { Alert } from "@ktbhealth/ui/components/alert";
import { Button, buttonVariants } from "@ktbhealth/ui/components/button";
import { Checkbox } from "@ktbhealth/ui/components/checkbox";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";
import { Input } from "@ktbhealth/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@ktbhealth/ui/components/tabs";
import { anamnesisToText } from "@ktb/anamnesis";
import type { Anamnesis, AnamnesisSectionKey } from "@ktb/anamnesis";
import { SAMPLE_TRANSCRIPT } from "@ktb/anamnesis";
import { birthDateFromAge, errorMessage, type PatientErrors } from "@ktb/patients/record";
import {
	needsServerFallback,
	type Transcriber,
	type TranscriptionBackend,
} from "@ktb/transcription";

import { CONF_BAR, CONF_STYLE } from "./-ui.ts";
import { consultationMessages } from "../i18n.ts";
import {
	AudioTranscriptPanel,
	useConsultationAudio,
	type ConsultationAudioInfo,
	type TranscriptView,
} from "./-transcript.tsx";

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
					done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
				}`}
			>
				{done ? "✓" : n}
			</span>
			<span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
		</span>
	);
}

export interface NewConsultationApi {
	getLiveConsultation(input: { data: number }): Promise<{
		transcript: string;
		status: string | null;
	} | null>;
	extractAnamnesis(input: {
		data: { transcript: string; patientId?: number };
	}): Promise<{ anamnesis: Anamnesis; engine: string }>;
	attachAnamnesis(input: {
		data: {
			consultationId: number;
			anamnesis: Anamnesis;
			engine: string;
			// Tri-state: undefined keeps the link, null clears it.
			patientId?: number | null;
		};
	}): Promise<{ ok: boolean }>;
	saveConsultation(input: { data: unknown }): Promise<{ id: number; updated?: boolean }>;
	recordConsent(input: { data: number }): Promise<{ ok: boolean }>;
	/** Quick registration: name + approximate (year-only) birth date. */
	createPatient(input: {
		data: { name: string; birthDate: string };
	}): Promise<
		{ ok: true; patient: { id: number; name: string } } | { ok: false; errors: PatientErrors }
	>;
	/** Optional: refetch after audio upload to track server transcription. */
	getConsultation?(input: { data: number }): Promise<ConsultationAudioInfo | null>;
}

export function NewConsultationPage({
	initialPatients,
	initialPatientId,
	api,
	backend,
	locale = "en",
}: {
	initialPatients: Array<{ id: number; name: string }>;
	/** Preselect a patient (e.g. "New consultation" from the patient record). */
	initialPatientId?: number;
	api: NewConsultationApi;
	backend: TranscriptionBackend;
	/** Active UI locale, injected by the host (route loader / panel ctx). */
	locale?: string;
}) {
	const t = consultationMessages(locale);
	const nc = t.newConsultation;
	const [recording, setRecording] = useState(false);
	const [supported] = useState(() => backend.mic().supported);
	const [transcript, setTranscript] = useState("");
	const [partial, setPartial] = useState("");
	const [anamnesis, setAnamnesis] = useState<Anamnesis | null>(null);
	const [engine, setEngine] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
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
	const [patientId, setPatientId] = useState<number | null>(() =>
		initialPatients.some((p) => p.id === initialPatientId) ? initialPatientId! : null,
	);
	const [patientName, setPatientName] = useState("");
	const [patientAge, setPatientAge] = useState("");
	const [patientError, setPatientError] = useState<string | null>(null);
	const [quickCreatedId, setQuickCreatedId] = useState<number | null>(null);
	const [patients, setPatients] = useState<Array<{ id: number; name: string }>>(() =>
		initialPatients.map((p: { id: number; name: string }) => ({
			id: p.id,
			name: p.name,
		})),
	);
	const transcriberRef = useRef<Transcriber | null>(null);
	const tabRef = useRef<Transcriber | null>(null);
	// Transcript length when each capture session started — lets the
	// server fallback splice out the low-confidence local output.
	const sessionSnapshot = useRef({ mic: 0, tab: 0, dict: 0 });
	const [tabRecording, setTabRecording] = useState(false);
	const [modelStatus, setModelStatus] = useState<string | null>(() => {
		const st = backend.status();
		return st.state === "ready" ? t.newConsultation.modelReady(st.device) : null;
	});
	const [toast, setToast] = useState<ToastData | null>(null);
	const [source, setSource] = useState<"record" | "bot" | "upload">("record");
	const [mode, setMode] = useState<"live" | "dictation">("live");
	const [dictating, setDictating] = useState(false);
	const [elapsedSec, setElapsedSec] = useState(0);
	const dictationStartRef = useRef(0);
	// Audio pipeline (P-015/P-018): after save, the session recording is
	// uploaded and the detail is polled for server/corrected transcripts.
	const [audioConsultId, setAudioConsultId] = useState<number | null>(null);
	const [viewedText, setViewedText] = useState<TranscriptView | null>(null);
	const uploadedAudioFor = useRef(new Set<number>());
	const pendingUploadBlob = useRef<Blob | null>(null);

	// Preload Whisper once per page: first visit downloads, later ones
	// come straight from the browser cache.
	useEffect(() => {
		const off = backend.subscribe((m) => {
			if (m.type === "progress") setModelStatus(m.message ?? null);
			if (m.type === "ready") setModelStatus(t.newConsultation.modelReady(m.device));
			if (m.type === "error" && !m.id)
				setModelStatus(t.newConsultation.modelUnavailable(m.message ?? ""));
		});
		backend.load();
		return off;
	}, []);

	useEffect(() => {
		const tr = backend.mic();
		transcriberRef.current = tr;
		tabRef.current = backend.tab();
		return () => {
			tr.stop();
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

	// Poll the saved consultation while the server pipeline works on the
	// uploaded audio (queued → processing → done/failed).
	const audioDetail = useConsultationAudio(
		audioConsultId !== null ? api.getConsultation : undefined,
		audioConsultId,
	);

	async function transcribeAudioBlob(blob: Blob, filename: string): Promise<string> {
		const form = new FormData();
		form.append("audio", blob, filename);
		const res = await fetch("/api/transcribe", { method: "POST", body: form });
		if (!res.ok) throw new Error(t.newConsultation.transcriptionFailedStatus(res.status));
		const { text } = (await res.json()) as { text: string };
		return text;
	}

	async function uploadAudio(file: File) {
		pendingUploadBlob.current = file;
		setBusy(true);
		setError(null);
		try {
			const text = await transcribeAudioBlob(file, file.name);
			setTranscript((t) => (t ? `${t}\n${text}` : text));
		} catch (e) {
			setError(e instanceof Error ? e.message : t.newConsultation.transcriptionFailed);
		} finally {
			setBusy(false);
		}
	}

	/**
	 * ADR-0002 fallback: when a finished capture session looks low-quality
	 * (little transcript per voiced second), re-transcribe the recorded
	 * audio on the server and splice the result in place of the local
	 * lines. No-op for transcribers without stats/recording support.
	 */
	async function maybeServerFallback(mode: "mic" | "tab" | "dict") {
		const tr = mode === "tab" ? tabRef.current : transcriberRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any capture ends */
		if (!tr) return;
		const stats = tr.sessionStats?.();
		if (!stats || !needsServerFallback(stats)) return;
		const blob = await tr.recording?.();
		if (!blob) return;
		setModelStatus(t.newConsultation.lowConfidenceReprocessing);
		try {
			const text = await transcribeAudioBlob(blob, "session.webm");
			if (!text.trim()) return;
			const snap = sessionSnapshot.current[mode];
			const label =
				mode === "mic" ? `${t.speakers.doctor}:` : mode === "tab" ? `${t.speakers.patient}:` : "";
			setTranscript((prev) => {
				const base = prev.slice(0, snap).replace(/\s+$/, "");
				const line = label ? `${label} ${text}` : text;
				return base ? `${base}\n${line}` : line;
			});
			setModelStatus(t.newConsultation.transcriptionRedone);
		} catch {
			setModelStatus(null);
		}
	}

	async function sendBot() {
		/* v8 ignore next -- Send bot is disabled while meetUrl is empty */
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
			setError(data.error ?? t.newConsultation.botFailed(res.status));
			return;
		}
		setLiveId(data.consultationId);
		setLiveStatus("live");
	}

	function toggleRecording() {
		const tr = transcriberRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any click */
		if (!tr) return;
		if (recording) {
			tr.stop();
			setRecording(false);
			return;
		}
		setError(null);
		sessionSnapshot.current.mic = transcript.length;
		tr.start((ev) => {
			if (ev.type === "partial") setPartial(ev.text);
			if (ev.type === "final") {
				setTranscript((prev) => `${prev}${prev ? "\n" : ""}${t.speakers.doctor}: ${ev.text}`);
				setPartial("");
			}
			if (ev.type === "error") {
				setError(ev.message);
				setRecording(false);
			}
			if (ev.type === "end") {
				setRecording(false);
				setPartial("");
				void maybeServerFallback("mic");
			}
		});
		setRecording(true);
	}

	function toggleTabCapture() {
		const tr = tabRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any click */
		if (!tr) return;
		if (tabRecording) {
			tr.stop();
			setTabRecording(false);
			return;
		}
		setError(null);
		sessionSnapshot.current.tab = transcript.length;
		tr.start((ev) => {
			if (ev.type === "partial") setPartial(ev.text);
			if (ev.type === "final") {
				setTranscript((prev) => `${prev}${prev ? "\n" : ""}${t.speakers.patient}: ${ev.text}`);
				setPartial("");
			}
			if (ev.type === "error") {
				setError(ev.message);
				setTabRecording(false);
			}
			if (ev.type === "end") {
				setTabRecording(false);
				setPartial("");
				void maybeServerFallback("tab");
			}
		});
		setTabRecording(true);
	}

	/**
	 * Post-consultation dictation: same mic transcriber (Whisper), single
	 * speaker — finals land in the transcript without a speaker prefix
	 * since the narration already describes the whole consultation.
	 */
	function toggleDictation() {
		const tr = transcriberRef.current;
		/* v8 ignore next -- refs are assigned in useEffect before any click */
		if (!tr) return;
		if (dictating) {
			tr.stop();
			setDictating(false);
			return;
		}
		setError(null);
		dictationStartRef.current = Date.now();
		setElapsedSec(0);
		sessionSnapshot.current.dict = transcript.length;
		tr.start((ev) => {
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
				void maybeServerFallback("dict");
			}
		});
		setDictating(true);
	}

	/**
	 * P-015 client half: push the session recording to R2 after the
	 * consultation exists. The endpoint keeps a single audio object per
	 * consultation, so only one blob is uploaded — the call-tab capture
	 * (both parties) wins over the mic, which wins over an uploaded file.
	 * Fire-and-forget: a failure surfaces as a toast, never blocks save.
	 */
	async function uploadSessionAudio(id: number) {
		if (uploadedAudioFor.current.has(id)) return;
		try {
			const [tabBlob, micBlob] = await Promise.all([
				tabRef.current?.recording?.() ?? Promise.resolve(null),
				transcriberRef.current?.recording?.() ?? Promise.resolve(null),
			]);
			const blob = tabBlob ?? micBlob ?? pendingUploadBlob.current;
			if (!blob || blob.size === 0) return;
			uploadedAudioFor.current.add(id);
			const res = await fetch(`/api/consultations/${id}/audio`, {
				method: "POST",
				headers: { "content-type": (blob.type || "audio/webm").split(";")[0] },
				body: blob,
			});
			if (!res.ok) throw new Error(`audio upload failed (${res.status})`);
			setAudioConsultId(id);
		} catch (e) {
			showToast({
				text: t.newConsultation.audioUploadFailed(e instanceof Error ? e.message : "error"),
			});
		}
	}

	async function generate() {
		const text = viewedText?.text ?? transcript;
		/* v8 ignore next -- Generate anamnesis is disabled while transcript is empty */
		if (!text.trim()) return;
		setBusy(true);
		setError(null);
		setSavedId(null);
		try {
			const res = await api.extractAnamnesis({
				data: { transcript: text, patientId: patientId ?? undefined },
			});
			setAnamnesis(res.anamnesis);
			setEngine(res.engine);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	function showToast(t: Omit<ToastData, "id">) {
		setToast({ id: Date.now(), ...t });
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
						// null clears a previously linked patient; undefined
						// would keep it (tri-state on the wire).
						patientId,
					},
				});
				if (!r.ok) throw new Error(t.newConsultation.saveSessionExpired);
			} else {
				const res = await api.saveConsultation({
					data: {
						transcript,
						anamnesis,
						engine: engine ?? "unknown",
						patientId: patientId ?? undefined,
					},
				});
				id = res.id ?? null;
			}
			if (!id) throw new Error(t.newConsultation.saveFailed);
			if (consented) await api.recordConsent({ data: id });
			setSavedId(id);
			void uploadSessionAudio(id);
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
		/* v8 ignore next -- Copy button only renders with anamnesis */
		if (!anamnesis) return;
		const text = anamnesisToText(anamnesis);
		void navigator.clipboard.writeText(text).then(
			() => showToast({ text: t.newConsultation.anamnesisCopied }),
			() => setError(t.newConsultation.copyFailed),
		);
	}

	const step1 = consented && (patientId !== null || patients.length === 0);
	const step2 = transcript.trim().length > 0;
	const step3 = anamnesis !== null;
	const live = recording || tabRecording || dictating;
	// Anamnesis is generated from the transcript version on screen —
	// the corrected/server text once the audio pipeline panel is up.
	const extractText = viewedText?.text ?? transcript;
	/* v8 ignore next -- patientId only comes from the patients list or createPatient */
	const dialogPatientName = patientId
		? (patients.find((p) => p.id === patientId)?.name ?? t.newConsultation.patientFallback)
		: null;

	const cardCls = "rounded-2xl border border-border bg-card shadow-sm";

	return (
		<div>
			{/* ---- header + progress ---- */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">{nc.title}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{nc.subtitle}</p>
				</div>
				<div className="flex flex-wrap items-center gap-3 text-sm">
					<Step n={1} label={nc.steps.prepare} done={step1} />
					<span className="h-px w-6 bg-border" />
					<Step n={2} label={nc.steps.transcribe} done={step2} />
					<span className="h-px w-6 bg-border" />
					<Step n={3} label={nc.steps.review} done={step3} />
				</div>
			</div>

			{/* ---- mode: live consultation vs post-consultation dictation ---- */}
			<Tabs
				value={mode}
				onValueChange={(v) => setMode(v as "live" | "dictation")}
				className="mt-4 w-fit"
			>
				<TabsList aria-label={nc.modeLabel}>
					<TabsTrigger value="live" disabled={live}>
						{nc.modeLive}
					</TabsTrigger>
					<TabsTrigger value="dictation" disabled={live}>
						{nc.modeDictation}
					</TabsTrigger>
				</TabsList>
			</Tabs>

			{/* ---- 1. prepare: patient + consent ---- */}
			<section className={`${cardCls} mt-6 p-4`}>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
					<div className="flex items-center gap-2">
						<span
							id="patient-label"
							className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
						>
							{nc.patientLabel}
						</span>
						<Select
							value={patientId === null ? "" : String(patientId)}
							onValueChange={(v) => setPatientId(v ? Number(v) : null)}
							items={[
								{ label: nc.unlinked, value: "" },
								...patients.map((p) => ({ label: p.name, value: String(p.id) })),
							]}
						>
							<SelectTrigger aria-labelledby="patient-label" className="border-border">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">{nc.unlinked}</SelectItem>
								{patients.map((p) => (
									<SelectItem key={p.id} value={String(p.id)}>
										{p.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Input
							value={patientName}
							onChange={(e) => setPatientName(e.target.value)}
							placeholder={nc.newPatientPlaceholder}
							aria-label={nc.newPatientNameLabel}
							className="w-40"
						/>
						<Input
							type="number"
							min={0}
							max={130}
							inputMode="numeric"
							value={patientAge}
							onChange={(e) => setPatientAge(e.target.value)}
							placeholder={nc.agePlaceholder}
							aria-label={nc.newPatientAgeLabel}
							className="w-20"
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={async () => {
								if (!patientName.trim()) return;
								const age = Number(patientAge);
								if (patientAge === "" || !Number.isInteger(age) || age < 0) {
									setPatientError(nc.ageRequired);
									return;
								}
								setPatientError(null);
								const res = await api.createPatient({
									data: { name: patientName, birthDate: birthDateFromAge(age) },
								});
								if (!res.ok) {
									// Validation comes back as codes; this view is English-only (T-025).
									const code = Object.values(res.errors)[0];
									setPatientError(code ? errorMessage(code, locale) : nc.patientCreateFailed);
									return;
								}
								const p = res.patient;
								setPatients((prev) => [...prev, { id: p.id, name: p.name }]);
								setPatientId(p.id);
								setQuickCreatedId(p.id);
								setPatientName("");
								setPatientAge("");
							}}
						>
							{nc.addPatient}
						</Button>
						{patientError ? (
							<span role="alert" className="text-xs text-destructive">
								{patientError}
							</span>
						) : null}
						{quickCreatedId !== null && quickCreatedId === patientId ? (
							<Link
								to="/patients/$id/edit"
								params={{ id: String(quickCreatedId) }}
								className="text-xs font-medium underline"
							>
								{nc.completeRecord}
							</Link>
						) : null}
					</div>
					<label
						className={`ml-auto flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs ${
							consented
								? "bg-primary/10 text-primary ring-1 ring-primary/20"
								: "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
						}`}
					>
						<Checkbox
							checked={consented}
							onCheckedChange={(checked) => setConsented(checked === true)}
						/>
						{nc.consentDeclaration}
					</label>
				</div>
			</section>

			<div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
				{/* ================= left column: transcript ================= */}
				<section className={cardCls}>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<h2 className="font-semibold">{t.common.transcript}</h2>
						{mode === "live" ? (
							<Tabs
								value={source}
								onValueChange={(v) => setSource(v as "record" | "upload" | "bot")}
								className="w-fit"
							>
								<TabsList className="text-xs">
									<TabsTrigger value="record">{nc.tabRecord}</TabsTrigger>
									<TabsTrigger value="upload">{nc.tabUpload}</TabsTrigger>
									<TabsTrigger value="bot">{nc.tabBot}</TabsTrigger>
								</TabsList>
							</Tabs>
						) : null}
					</div>

					<div className="space-y-4 p-5">
						{mode === "dictation" ? (
							<div className="flex flex-col items-center gap-3 rounded-xl border border-border px-6 py-8 text-center">
								<p className="max-w-md text-sm text-muted-foreground">{nc.dictationDescription}</p>
								<Button
									type="button"
									onClick={toggleDictation}
									disabled={!supported || !consented}
									className={`h-auto gap-3 rounded-full px-6 py-3 text-sm font-semibold ${
										dictating ? "bg-red-600 text-white hover:bg-red-700" : ""
									}`}
								>
									<span
										className={`size-3 rounded-full ${dictating ? "animate-pulse bg-white" : "bg-white/70"}`}
									/>
									{dictating ? nc.stopDictation(fmtElapsed(elapsedSec)) : nc.startDictation}
								</Button>
								{dictating ? (
									<p className="text-xs text-muted-foreground">
										{nc.dictatingHint(fmtElapsed(elapsedSec))}
									</p>
								) : null}
								{!consented ? (
									<Alert className="border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
										{nc.consentRequiredDictation}
									</Alert>
								) : null}
								{!supported ? (
									<p className="text-xs text-amber-600">{nc.unsupportedBrowser}</p>
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
									{busy ? nc.uploading : nc.uploadRecording}
								</span>
								<span className="text-[11px]">{nc.uploadHint}</span>
							</label>
						) : source === "record" ? (
							<>
								<div className="grid gap-3 sm:grid-cols-2">
									<Button
										type="button"
										variant="outline"
										onClick={toggleRecording}
										disabled={!supported || !consented}
										className={`h-auto flex-col items-start rounded-xl p-3 text-left ${
											recording ? "border-red-300 bg-red-50" : ""
										}`}
									>
										<span className="flex items-center gap-2 text-sm font-medium">
											{recording ? (
												<span className="size-2.5 animate-pulse rounded-full bg-red-600" />
											) : (
												<span className="size-2.5 rounded-full bg-muted-foreground" />
											)}
											{recording ? nc.stopMic : nc.recordMic}
										</span>
										<span className="mt-1 text-[11px] text-muted-foreground">
											{nc.micHint(t.speakers.doctor)}
										</span>
									</Button>
									<Button
										type="button"
										variant="outline"
										onClick={toggleTabCapture}
										disabled={!consented}
										className={`h-auto flex-col items-start rounded-xl p-3 text-left ${
											tabRecording ? "border-red-300 bg-red-50" : ""
										}`}
									>
										<span className="flex items-center gap-2 text-sm font-medium">
											{tabRecording ? (
												<span className="size-2.5 animate-pulse rounded-full bg-red-600" />
											) : (
												<span className="size-2.5 rounded-full bg-muted-foreground" />
											)}
											{tabRecording ? nc.stopTab : nc.captureTab}
										</span>
										<span className="mt-1 text-[11px] text-muted-foreground">
											{nc.tabHint(t.speakers.patient)}
										</span>
									</Button>
								</div>
								{!consented ? (
									<Alert className="border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
										{nc.consentRequiredRecording}
									</Alert>
								) : (
									<p className="text-[11px] text-muted-foreground">{nc.recordingTip}</p>
								)}
								{!supported ? (
									<p className="text-xs text-amber-600">{nc.unsupportedBrowser}</p>
								) : null}
							</>
						) : (
							<div>
								<div className="flex items-center gap-2">
									<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
										{nc.channelsBadge}
									</span>
								</div>
								<p className="mt-2 text-xs text-muted-foreground">{nc.botDescription}</p>
								<div className="mt-3 flex gap-2">
									<Input
										type="url"
										value={meetUrl}
										onChange={(e) => setMeetUrl(e.target.value)}
										aria-label={nc.teleconsultLinkLabel}
										placeholder="https://meet.google.com/xxx-xxxx-xxx"
									/>
									<Button
										type="button"
										onClick={sendBot}
										disabled={!meetUrl.trim() || liveStatus === "live"}
										className="shrink-0"
									>
										{liveStatus === "live" ? nc.botInCall : nc.sendBot}
									</Button>
								</div>
								{liveId ? (
									<p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
										{liveStatus === "live" ? (
											<span className="size-2 animate-pulse rounded-full bg-red-600" />
										) : (
											<span className="size-2 rounded-full bg-primary" />
										)}
										{nc.consultationLive(
											liveId,
											liveStatus === "live" ? nc.transcribingLive : nc.callEnded,
										)}
									</p>
								) : null}
							</div>
						)}

						{/* state: model / recording / partial */}
						<div className="flex flex-wrap items-center gap-2 text-xs">
							{modelStatus ? (
								<span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
									<BrainIcon className="mr-1 inline size-3.5" />
									{modelStatus}
								</span>
							) : null}
							{live ? (
								<span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-red-700">
									<span className="size-2 animate-pulse rounded-full bg-red-600" />
									{nc.recordingSpeak}
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
									{nc.consultationText}
								</label>
								<div className="flex gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
									>
										{nc.useSample}
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => setTranscript("")}
										disabled={!transcript}
									>
										{nc.clear}
									</Button>
								</div>
							</div>
							<textarea
								id="transcript"
								value={transcript}
								onChange={(e) => setTranscript(e.target.value)}
								rows={14}
								placeholder={nc.transcriptPlaceholder}
								className="w-full resize-y rounded-xl border border-border px-3 py-2.5 font-mono text-sm leading-relaxed"
							/>
						</div>

						{audioDetail || audioConsultId !== null ? (
							<div className="rounded-xl border border-border p-3">
								<p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{nc.serverTranscript}
								</p>
								<AudioTranscriptPanel
									locale={locale}
									consultationId={audioConsultId}
									audioStatus={audioDetail?.audioStatus ?? "queued"}
									hasAudio={Boolean(audioDetail?.audioKey)}
									browserText={transcript}
									serverText={audioDetail?.serverTranscript}
									correctedText={audioDetail?.correctedTranscript}
									onActiveText={setViewedText}
								/>
							</div>
						) : null}

						<Button
							type="button"
							onClick={generate}
							disabled={busy || !extractText.trim()}
							className="h-auto w-full px-4 py-2.5"
						>
							{busy ? <Spinner /> : null}
							{busy ? nc.generating : nc.generate}
						</Button>
						{viewedText ? (
							<p className="text-[11px] text-muted-foreground">
								{nc.generatedFrom(viewedText.source)}
							</p>
						) : null}
						{error ? (
							<Alert variant="destructive" className="px-3 py-2 text-xs">
								{error}
							</Alert>
						) : null}
					</div>
				</section>

				{/* ================= right column: result ================= */}
				<section className={`${cardCls} lg:sticky lg:top-4`}>
					<div className="flex items-center justify-between border-b border-border px-5 py-3">
						<span className="text-sm font-medium">{t.common.anamnesis}</span>
						{engine ? (
							<span className="text-[11px] text-muted-foreground">{t.common.engine(engine)}</span>
						) : null}
					</div>

					{!anamnesis ? (
						<Empty className="px-5 py-14">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ClipboardListIcon />
								</EmptyMedia>
								<EmptyTitle>{nc.waitingTitle}</EmptyTitle>
								<EmptyDescription className="max-w-xs">{nc.waitingDescription}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="max-h-[68vh] space-y-3 overflow-y-auto p-5">
							{anamnesis.historico ? (
								<div className="rounded-xl border border-border bg-muted/40 p-3">
									<p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
										{t.sections.historico}
									</p>
									<p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
										{anamnesis.historico.content}
									</p>
								</div>
							) : null}
							{(
								Object.keys(t.sections).filter((k) => k !== "historico") as AnamnesisSectionKey[]
							).map((key) => {
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
												{t.sections[key]}
											</label>
											<span
												className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${CONF_STYLE[sec.confidence]}`}
											>
												{t.confidence[sec.confidence]}
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
													{t.detail.evidence(sec.evidence.length)}
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
					)}

					{anamnesis ? (
						<div className="flex items-center gap-2 border-t border-border px-5 py-3">
							<Button type="button" variant="outline" size="sm" onClick={copyAnamnesis}>
								{t.common.copy}
							</Button>
							<Button type="button" size="sm" onClick={save} disabled={saving}>
								{saving ? <Spinner /> : null}
								{saving ? nc.saving : savedId ? nc.updateConsultation : nc.saveConsultation}
							</Button>
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
						? nc.dialogErrorTitle
						: saveDialog?.updated
							? nc.dialogUpdatedTitle
							: nc.dialogSavedTitle
				}
				actions={
					saveDialog?.kind === "ok" ? (
						<>
							<a
								href={`/api/consultations/${saveDialog.id}/pdf`}
								download
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								<DownloadIcon className="mr-1.5 inline size-4 -translate-y-px" />
								{t.common.downloadPdf}
							</a>
							<Link
								to="/consultations/$id"
								params={{ id: String(saveDialog.id) }}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{nc.viewConsultation}
							</Link>
							<Button type="button" size="sm" onClick={() => setSaveDialog(null)}>
								{nc.confirm}
							</Button>
						</>
					) : (
						<Button type="button" size="sm" onClick={() => setSaveDialog(null)}>
							{nc.gotIt}
						</Button>
					)
				}
			>
				{saveDialog?.kind === "ok" ? (
					<p>
						{nc.dialogSavedBody({
							id: saveDialog.id,
							patientName: dialogPatientName,
							updated: saveDialog.updated,
							consented,
						})}
					</p>
				) : (
					<p>{saveDialog?.kind === "error" ? saveDialog.message : ""}</p>
				)}
			</Dialog>
		</div>
	);
}
