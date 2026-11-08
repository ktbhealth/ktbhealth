import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";

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
		setStatus("requesting tab…");
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: { echoCancellation: false, noiseSuppression: false },
			});
			for (const t of stream.getVideoTracks()) t.stop();
			const track = stream.getAudioTracks()[0];
			if (!track) {
				setError("shared tab has no audio. Enable 'share audio'");
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
			setStatus(`capturing · track: ${track.label} | ${track.readyState}`);

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
			<h1 className="text-2xl font-bold">Spike: tab audio capture</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				1. Open a call (WhatsApp Web, Meet, YouTube) in another tab. 2. Click start and select THAT
				tab with &quot;share audio&quot; enabled. 3. If the meter moves with speech, the path is
				proven.
			</p>
			<div className="mt-6 flex gap-2">
				<button
					type="button"
					onClick={start}
					className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/80"
				>
					Start capture
				</button>
				<button
					type="button"
					onClick={stop}
					className="rounded-lg border border-border px-4 py-2 text-sm"
				>
					Stop
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
			<p className="mt-1 text-xs text-muted-foreground">level: {(level * 100).toFixed(1)}%</p>
		</div>
	);
}
