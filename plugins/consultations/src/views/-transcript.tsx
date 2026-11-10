import { useEffect, useRef, useState } from "react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ktbhealth/ui/components/tabs";

import { BADGE_TONES, SPEAKER_STYLE } from "./-ui.ts";
import { consultationMessages } from "../i18n.ts";

/** "Doctor: text" lines become chat-style bubbles. */
function Transcript({ text, emptyLabel }: { text: string; emptyLabel: string }) {
	const lines = text.split("\n").filter((l) => l.trim());
	if (!lines.length) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
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

// ---------- audio pipeline (P-015..P-018) ----------

/** Subset of the consultation detail the transcript panel needs. */
export interface AudioPipelineInfo {
	audioStatus?: string | null;
	audioKey?: string | null;
	serverTranscript?: string | null;
	correctedTranscript?: string | null;
}

/** Loose shape returned by `getConsultation` fns — extra fields ignored. */
export interface ConsultationAudioInfo extends AudioPipelineInfo {
	id?: number;
	transcript?: string | null;
}

const IN_FLIGHT = new Set(["stored", "queued", "processing"]);
const TERMINAL = new Set(["none", "done", "failed"]);
const POLL_MS = 3000;
/** Extra polls after "done" — the LLM cleanup lands just after the ASR pass. */
const SETTLE_POLLS = 3;

const nonEmpty = (s: string | null | undefined): s is string =>
	typeof s === "string" && s.trim().length > 0;

/**
 * Poll `getConsultation` while the audio pipeline is in flight, and a
 * few extra ticks after "done" so the corrected transcript (written by
 * the same job, right after the server transcript) is picked up.
 * Returns the latest fetched detail, retained after polling stops.
 */
export function useConsultationAudio<T extends AudioPipelineInfo>(
	fetcher: ((input: { data: number }) => Promise<T | null>) | undefined,
	consultationId: number | null,
): T | null {
	const [state, setState] = useState<{ id: number; data: T } | null>(null);
	useEffect(() => {
		if (!fetcher || consultationId === null) return;
		let cancelled = false;
		let settleLeft = SETTLE_POLLS;
		let timer: ReturnType<typeof setInterval> | undefined;
		// clearInterval(undefined) is a no-op, so no guard is needed.
		const stop = () => clearInterval(timer);
		const tick = async () => {
			try {
				const d = await fetcher({ data: consultationId });
				if (cancelled || !d) return;
				setState({ id: consultationId, data: d });
				const status = d.audioStatus ?? "none";
				if (IN_FLIGHT.has(status)) {
					settleLeft = SETTLE_POLLS;
					return;
				}
				if (TERMINAL.has(status)) {
					// "done" still awaits the LLM cleanup pass; give it a
					// few ticks, then stop. failed/none stop immediately.
					const awaitingCorrected =
						status === "done" && nonEmpty(d.serverTranscript) && !nonEmpty(d.correctedTranscript);
					if (awaitingCorrected && settleLeft-- > 0) return;
					stop();
				}
			} catch {
				// transient fetch failure — keep polling
			}
		};
		void tick();
		timer = setInterval(() => void tick(), POLL_MS);
		return () => {
			cancelled = true;
			stop();
		};
	}, [fetcher, consultationId]);
	return state !== null && state.id === consultationId ? state.data : null;
}

// ---------- original vs corrected transcript view (P-018) ----------

export interface TranscriptView {
	text: string;
	/** Short provenance caption, e.g. "server · whisper large-v3-turbo". */
	source: string;
}

export interface TranscriptSourceLabels {
	readonly server: string;
	readonly browser: string;
	readonly corrected: string;
}

/**
 * Raw ASR outputs, server first. The browser transcript joins as a
 * second labeled block when it differs — both are unedited evidence.
 * Captions come localized from the caller's catalog.
 */
function originalBlocks(
	browser: string | null,
	server: string | null,
	labels: TranscriptSourceLabels,
): TranscriptView[] {
	const blocks: TranscriptView[] = [];
	if (nonEmpty(server)) blocks.push({ text: server, source: labels.server });
	if (nonEmpty(browser) && (!nonEmpty(server) || browser.trim() !== server.trim())) {
		blocks.push({ text: browser, source: labels.browser });
	}
	return blocks;
}

function SourceBlock({ view, emptyLabel }: { view: TranscriptView; emptyLabel: string }) {
	return (
		<div>
			<p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
				{view.source}
			</p>
			<Transcript text={view.text} emptyLabel={emptyLabel} />
		</div>
	);
}

/**
 * Transcript area for consultations with (or pending) server-side
 * audio processing: status chip, optional audio playback, and
 * Corrected/Original tabs once an LLM-cleaned transcript exists.
 * Without server data it degrades to the plain browser transcript.
 */
export function AudioTranscriptPanel({
	consultationId,
	audioStatus,
	hasAudio,
	browserText,
	serverText,
	correctedText,
	onActiveText,
	locale = "en",
}: {
	consultationId: number | null;
	/** Active UI locale — resolves the panel's copy and source captions. */
	locale?: string;
	audioStatus?: string | null;
	hasAudio?: boolean;
	browserText?: string | null;
	serverText?: string | null;
	correctedText?: string | null;
	/** Reports the text currently on screen so callers (anamnesis
	 *  generation) use exactly what the doctor is viewing. */
	onActiveText?: (view: TranscriptView) => void;
}) {
	const t = consultationMessages(locale);
	const [tab, setTab] = useState<"corrected" | "original">("corrected");
	const status = audioStatus ?? "none";
	const sourceLabels: TranscriptSourceLabels = {
		server: t.transcriptPanel.sourceServer,
		browser: t.transcriptPanel.sourceBrowser,
		corrected: t.transcriptPanel.sourceCorrected,
	};
	const originals = originalBlocks(browserText ?? null, serverText ?? null, sourceLabels);
	const correctedView: TranscriptView | null = nonEmpty(correctedText)
		? { text: correctedText, source: sourceLabels.corrected }
		: null;
	const primaryOriginal = originals[0] ?? null;
	// Tabs only earn their keep when a corrected text exists AND differs
	// from the raw ASR output; otherwise a single pane is clearer.
	const tabbed =
		correctedView !== null &&
		primaryOriginal !== null &&
		correctedView.text.trim() !== primaryOriginal.text.trim()
			? { corrected: correctedView, original: primaryOriginal }
			: null;

	const active: TranscriptView | null = tabbed
		? tab === "corrected"
			? tabbed.corrected
			: tabbed.original
		: (correctedView ?? primaryOriginal);
	const lastReported = useRef("");
	useEffect(() => {
		if (!active || !onActiveText) return;
		const key = `${active.source}\n${active.text}`;
		if (key === lastReported.current) return;
		lastReported.current = key;
		onActiveText(active);
	}, [active?.text, active?.source, onActiveText]);

	const inFlight = IN_FLIGHT.has(status);

	return (
		<div className="space-y-3">
			{status === "failed" || inFlight || correctedView ? (
				<div className="flex flex-wrap items-center gap-2">
					{status === "failed" ? (
						<Badge variant="secondary" className={`ring-1 ${BADGE_TONES.red}`}>
							{t.transcriptPanel.enhancementFailed}
						</Badge>
					) : inFlight ? (
						<Badge variant="secondary" className={`ring-1 ${BADGE_TONES.amber}`}>
							<span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-500" />
							{status === "stored" ? t.transcriptPanel.audioStored : t.transcriptPanel.enhancing}
						</Badge>
					) : (
						// Outer condition: failed || inFlight || correctedView — so
						// here correctedView is set.
						<Badge variant="secondary" className={`ring-1 ${BADGE_TONES.green}`}>
							{t.transcriptPanel.enhanced}
						</Badge>
					)}
					{hasAudio && consultationId !== null ? (
						<audio
							controls
							preload="none"
							src={`/api/consultations/${consultationId}/audio`}
							aria-label={t.transcriptPanel.audioLabel}
							className="h-8 w-full max-w-xs"
						/>
					) : null}
				</div>
			) : null}

			{tabbed ? (
				<Tabs
					value={tab}
					onValueChange={(v) => setTab(v as "corrected" | "original")}
					className="w-full"
				>
					<TabsList className="text-xs">
						<TabsTrigger value="corrected">{t.transcriptPanel.tabCorrected}</TabsTrigger>
						<TabsTrigger value="original">{t.transcriptPanel.tabOriginal}</TabsTrigger>
					</TabsList>
					<TabsContent value="corrected" className="pt-2">
						<SourceBlock view={tabbed.corrected} emptyLabel={t.common.noTranscript} />
					</TabsContent>
					<TabsContent value="original" className="space-y-4 pt-2">
						{originals.map((b) => (
							<SourceBlock key={b.source} view={b} emptyLabel={t.common.noTranscript} />
						))}
					</TabsContent>
				</Tabs>
			) : originals.length ? (
				<div className="space-y-4">
					{originals.map((b) => (
						<SourceBlock key={b.source} view={b} emptyLabel={t.common.noTranscript} />
					))}
				</div>
			) : correctedView ? (
				<SourceBlock view={correctedView} emptyLabel={t.common.noTranscript} />
			) : (
				<Transcript text="" emptyLabel={t.common.noTranscript} />
			)}
		</div>
	);
}
