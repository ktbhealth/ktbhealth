import json, resource, time, os, sys
from pathlib import Path
import soundfile as sf

os.environ["OMP_NUM_THREADS"] = "4"

def rss_mb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

from faster_whisper import WhisperModel

AUDIO_DIR = Path(os.environ.get("BENCH_AUDIO_DIR", Path(__file__).parent / "audio"))
OUT_JSON = Path(os.environ.get("BENCH_RESULTS", Path(__file__).parent / "asr-results.json"))
AUDIO = sorted(AUDIO_DIR.glob("s*.wav"))
MODELS = sys.argv[1:] or ["tiny", "base", "small"]
results = []

for name in MODELS:
    t0 = time.time()
    model = WhisperModel(name, device="cpu", compute_type="int8")
    load_s = time.time() - t0
    total_audio = total_time = 0.0
    hyps = []
    for wav in AUDIO:
        data, sr = sf.read(wav, dtype="float32")
        dur = len(data) / sr
        t1 = time.time()
        segs, _ = model.transcribe(data, language="pt", beam_size=5, vad_filter=True)
        text = " ".join(sg.text for sg in segs).strip()
        elapsed = time.time() - t1
        total_audio += dur; total_time += elapsed
        hyps.append(text)
    rtf = total_time / total_audio
    results.append({
        "model": name, "load_s": round(load_s,1), "peak_rss_mb": round(rss_mb()),
        "audio_s": round(total_audio,1), "infer_s": round(total_time,1),
        "rtf": round(rtf,3), "hyps": hyps,
    })
    print(f"[{name}] load={load_s:.0f}s rtf={rtf:.2f} rss={rss_mb():.0f}MB", flush=True)
    del model

with open(OUT_JSON,"w") as f:
    json.dump(results, f, ensure_ascii=False, indent=1)
print("done")
