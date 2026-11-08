import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import * as m from "#/paraglide/messages.js";

export const Route = createFileRoute("/capture-test")({
	component: CaptureTest,
});

/** Spike: proves that tab audio (e.g. a WhatsApp Web call) is capturable. */
function CaptureTest() {
	const [level, setLevel] = useState(0);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const refs = useRef<{
		stream?: MediaStream;
		ctx?: AudioContext;
		raf?: number;
	}>({});

	async function start() {
		setError(null);
		setStatus(m.capture_status_requesting());
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: { echoCancellation: false, noiseSuppression: false },
			});
			for (const t of stream.getVideoTracks()) t.stop();
			const track = stream.getAudioTracks()[0];
			if (!track) {
				setError(m.capture_error_no_audio());
				return;
			}
			refs.current.stream = stream;
			const ctx = new AudioContext();
			refs.current.ctx = ctx;
			const src = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			src.connect(analyser);
			const data = new Uint8Array(analyser.frequencyBinCount);
			setStatus(m.capture_status_capturing({ track: track.label, state: track.readyState }));

			const tick = () => {
				analyser.getByteTimeDomainData(data);
				let sum = 0;
				for (const v of data) sum += (v - 128) ** 2;
				setLevel(Math.sqrt(sum / data.length) / 128);
				refs.current.raf = requestAnimationFrame(tick);
			};
			tick();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	function stop() {
		if (refs.current.raf) cancelAnimationFrame(refs.current.raf);
		for (const t of refs.current.stream?.getTracks() ?? []) t.stop();
		void refs.current.ctx?.close();
		setLevel(0);
		setStatus(null);
	}

	return (
		<div>
			<h1 className="text-2xl font-bold">{m.capture_title()}</h1>
			<p className="mt-2 text-sm text-muted-foreground">{m.capture_desc()}</p>
			<div className="mt-6 flex gap-2">
				<button
					type="button"
					onClick={start}
					className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/80"
				>
					{m.capture_start()}
				</button>
				<button
					type="button"
					onClick={stop}
					className="rounded-lg border border-border px-4 py-2 text-sm"
				>
					{m.capture_stop()}
				</button>
			</div>
			{status ? <p className="mt-3 text-xs text-muted-foreground">{status}</p> : null}
			{error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
			<div className="mt-6 h-6 w-full overflow-hidden rounded bg-muted">
				<div
					className="h-full bg-primary transition-[width] duration-75"
					style={{ width: `${Math.min(100, level * 400)}%` }}
				/>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				{m.capture_level({ level: (level * 100).toFixed(1) })}
			</p>
		</div>
	);
}
