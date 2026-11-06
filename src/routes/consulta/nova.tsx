import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { type Anamnesis, SECTION_LABELS } from "#/lib/anamnese/index.ts";
import type { AnamnesisSectionKey, Confidence } from "#/lib/anamnese/types.ts";
import {
	attachAnamnesisFn,
	extractAnamneseFn,
	getLiveConsultationFn,
	saveConsultationFn,
} from "#/lib/fns.ts";
import { SAMPLE_TRANSCRIPT } from "#/lib/sample.ts";
import {
	createTabAudioTranscriber,
	createTranscriber,
} from "#/lib/transcriber/index.ts";

export const Route = createFileRoute("/consulta/nova")({
	component: NovaConsulta,
});

const CONF_STYLE: Record<Confidence, string> = {
	alta: "bg-emerald-50 text-emerald-700",
	media: "bg-amber-50 text-amber-700",
	baixa: "bg-neutral-100 text-neutral-500",
};

function NovaConsulta() {
	const [recording, setRecording] = useState(false);
	const [supported, setSupported] = useState(false);
	const [transcript, setTranscript] = useState("");
	const [partial, setPartial] = useState("");
	const [anamnesis, setAnamnesis] = useState<Anamnesis | null>(null);
	const [engine, setEngine] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [savedId, setSavedId] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [meetUrl, setMeetUrl] = useState("");
	const [liveId, setLiveId] = useState<number | null>(null);
	const [liveStatus, setLiveStatus] = useState<string | null>(null);
	const transcriberRef = useRef<ReturnType<typeof createTranscriber> | null>(
		null,
	);
	const tabRef = useRef<ReturnType<typeof createTabAudioTranscriber> | null>(
		null,
	);
	const [tabRecording, setTabRecording] = useState(false);

	useEffect(() => {
		const t = createTranscriber();
		transcriberRef.current = t;
		tabRef.current = createTabAudioTranscriber();
		setSupported(t.supported);
		return () => {
			t.stop();
			tabRef.current?.stop();
		};
	}, []);

	// Poll a live bot consultation — transcript grows as events arrive.
	useEffect(() => {
		if (!liveId || liveStatus === "done") return;
		const interval = setInterval(async () => {
			const res = await getLiveConsultationFn({ data: liveId });
			if (!res) return;
			setTranscript(res.transcript);
			setLiveStatus(res.status);
		}, 1500);
		return () => clearInterval(interval);
	}, [liveId, liveStatus]);

	async function sendBot() {
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
		if (!t) return;
		if (recording) {
			t.stop();
			setRecording(false);
			setPartial("");
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
		if (!t) return;
		if (tabRecording) {
			t.stop();
			setTabRecording(false);
			setPartial("");
			return;
		}
		setError(null);
		t.start((ev) => {
			if (ev.type === "partial") setPartial(ev.text);
			if (ev.type === "final") {
				setTranscript(
					(prev) => `${prev}${prev ? "\n" : ""}Paciente: ${ev.text}`,
				);
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

	async function generate() {
		if (!transcript.trim()) return;
		setBusy(true);
		setError(null);
		setSavedId(null);
		try {
			const res = await extractAnamneseFn({ data: transcript });
			setAnamnesis(res.anamnesis);
			setEngine(res.engine);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	async function save() {
		if (!anamnesis) return;
		if (liveId) {
			await attachAnamnesisFn({
				data: {
					consultationId: liveId,
					anamnesis,
					engine: engine ?? "unknown",
				},
			});
			setSavedId(liveId);
			return;
		}
		const res = await saveConsultationFn({
			data: { transcript, anamnesis, engine: engine ?? "unknown" },
		});
		if (res.id) setSavedId(res.id);
	}

	function updateSection(key: AnamnesisSectionKey, content: string) {
		setAnamnesis((a) => (a ? { ...a, [key]: { ...a[key], content } } : a));
	}

	function copyAnamnesis() {
		if (!anamnesis) return;
		const text = (Object.keys(SECTION_LABELS) as AnamnesisSectionKey[])
			.map((k) => `${SECTION_LABELS[k].toUpperCase()}\n${anamnesis[k].content}`)
			.join("\n\n");
		void navigator.clipboard.writeText(text);
	}

	return (
		<div>
			<h1 className="text-3xl font-bold">Nova consulta</h1>
			<p className="mt-1 text-sm text-neutral-500">
				Grave a conversa ou cole a transcrição — a anamnese sai estruturada para
				revisão.
			</p>

			{/* ---- teleconsulta (bot) ---- */}
			<section className="mt-6 rounded-xl border border-neutral-200 p-5">
				<div className="flex items-center gap-3">
					<h2 className="font-semibold">Teleconsulta</h2>
					<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
						speaker labels grátis via canais
					</span>
				</div>
				<p className="mt-1 text-xs text-neutral-500">
					O bot “Anamnese” entra na sua call (Meet/Zoom/Teams), transcreve com
					separação por falante e gera o rascunho quando a consulta acaba.
				</p>
				<div className="mt-3 flex gap-2">
					<input
						type="url"
						value={meetUrl}
						onChange={(e) => setMeetUrl(e.target.value)}
						placeholder="https://meet.google.com/xxx-xxxx-xxx"
						className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
					/>
					<button
						type="button"
						onClick={sendBot}
						disabled={!meetUrl.trim() || liveStatus === "live"}
						className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					>
						{liveStatus === "live" ? "bot na call…" : "Enviar bot"}
					</button>
				</div>
				{liveId ? (
					<p className="mt-2 text-xs text-neutral-500">
						consulta #{liveId} —{" "}
						{liveStatus === "live" ? "transcrevendo ao vivo" : "call encerrada"}
					</p>
				) : null}
			</section>

			<div className="mt-6 grid gap-6 lg:grid-cols-2">
				{/* ---- transcrição ---- */}
				<section className="rounded-xl border border-neutral-200 p-5">
					<div className="flex items-center justify-between">
						<h2 className="font-semibold">Transcrição</h2>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
								className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
							>
								Usar exemplo
							</button>
							<button
								type="button"
								onClick={toggleTabCapture}
								className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
									tabRecording ? "bg-red-600" : "bg-neutral-700"
								}`}
							>
								{tabRecording ? "■ Parar aba" : "🎧 Capturar aba"}
							</button>
							<button
								type="button"
								onClick={toggleRecording}
								disabled={!supported}
								className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
									recording ? "bg-red-600" : "bg-neutral-900"
								} disabled:opacity-40`}
							>
								{recording ? "■ Parar mic" : "● Gravar mic"}
							</button>
						</div>
					</div>

					{!supported ? (
						<p className="mt-2 text-xs text-amber-600">
							Reconhecimento de voz não suportado neste browser — use o botão de
							exemplo ou cole o texto (Chrome/Edge suportam).
						</p>
					) : null}
					{recording ? (
						<p className="mt-2 text-xs text-red-600">
							gravando… fale normalmente
						</p>
					) : null}
					{partial ? (
						<p className="mt-2 text-sm text-neutral-400 italic">{partial}…</p>
					) : null}

					<textarea
						value={transcript}
						onChange={(e) => setTranscript(e.target.value)}
						rows={12}
						placeholder="A transcrição aparece aqui (ou cole o texto da consulta)"
						className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm"
					/>

					<button
						type="button"
						onClick={generate}
						disabled={busy || !transcript.trim()}
						className="mt-3 w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
					>
						{busy ? "Gerando anamnese…" : "Gerar anamnese →"}
					</button>
					{error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
				</section>

				{/* ---- anamnese ---- */}
				<section className="rounded-xl border border-neutral-200 p-5">
					<div className="flex items-center justify-between">
						<h2 className="font-semibold">Anamnese</h2>
						{engine ? (
							<span className="text-xs text-neutral-400">engine: {engine}</span>
						) : null}
					</div>

					{!anamnesis ? (
						<p className="mt-4 text-sm text-neutral-400">
							A anamnese estruturada aparece aqui. Cada seção mostra a confiança
							e as frases-fonte que a fundamentam.
						</p>
					) : (
						<div className="mt-3 space-y-4">
							{(Object.keys(SECTION_LABELS) as AnamnesisSectionKey[]).map(
								(key) => {
									const s = anamnesis[key];
									return (
										<div key={key}>
											<div className="flex items-center gap-2">
												<span className="text-xs font-semibold text-neutral-700">
													{SECTION_LABELS[key]}
												</span>
												<span
													className={`rounded-full px-2 py-0.5 text-[10px] ${CONF_STYLE[s.confidence]}`}
												>
													{s.confidence}
												</span>
											</div>
											<textarea
												value={s.content}
												onChange={(e) => updateSection(key, e.target.value)}
												rows={Math.min(
													4,
													Math.max(2, Math.ceil(s.content.length / 80)),
												)}
												className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
											/>
											{s.evidence.length ? (
												<details className="mt-1">
													<summary className="cursor-pointer text-[11px] text-neutral-400">
														evidência ({s.evidence.length})
													</summary>
													<ul className="mt-1 list-inside list-disc text-[11px] text-neutral-500">
														{s.evidence.map((ev) => (
															<li key={ev.slice(0, 40)}>“{ev}”</li>
														))}
													</ul>
												</details>
											) : null}
										</div>
									);
								},
							)}

							<div className="flex gap-2 pt-2">
								<button
									type="button"
									onClick={copyAnamnesis}
									className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
								>
									Copiar
								</button>
								<button
									type="button"
									onClick={save}
									className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
								>
									Salvar consulta
								</button>
							</div>
							{savedId ? (
								<p className="text-xs text-emerald-600">
									Salva —{" "}
									<Link
										to="/consultas/$id"
										params={{ id: String(savedId) }}
										className="underline"
									>
										ver consulta #{savedId}
									</Link>
								</p>
							) : null}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
