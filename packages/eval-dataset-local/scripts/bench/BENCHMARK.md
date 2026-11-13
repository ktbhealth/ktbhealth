# ASR Pareto benchmark — 2025-11-13 (local CPU, 12 cores, int8)

Method: edge-tts synthesized 5 pt-BR clinical sentences (2 voices) →
faster-whisper transcribed (beam 5, VAD on) → WER via
`@ktb/eval-dataset` `metrics.ts` against the known scripts.

Reproduce:

```bash
uv venv /tmp/eval-bench && uv pip install --python /tmp/eval-bench/bin/python faster-whisper edge-tts soundfile
/tmp/eval-bench/bin/python scripts/bench/gen-audio.py     # writes audio/s*.mp3+.txt
for f in scripts/bench/audio/s*.mp3; do ffmpeg -i "$f" -ar 16000 -ac 1 "${f%.mp3}.wav"; done
/tmp/eval-bench/bin/python scripts/bench/bench-asr.py tiny base small turbo
bun scripts/bench/wer.ts scripts/bench/asr-results.json scripts/bench/audio
```

Caveat: clean TTS speech, n=5 — directional, not statistical. Real
consultations will score worse.

| model | load  | RTF (infer/audio)  | peak RSS | mean WER | Pareto                                           |
| ----- | ----- | ------------------ | -------- | -------- | ------------------------------------------------ |
| tiny  | 0s    | 0.06 (16x RT)      | 300MB    | .358     | dominated                                        |
| base  | 0s    | 0.08 (13x RT)      | 456MB    | .210     | frontier (speed)                                 |
| small | 1s    | 0.20 (5x RT)       | 1.1GB    | .179     | frontier (mid)                                   |
| turbo | 2–27s | 0.71–1.28 (~1x RT) | 2.7GB    | .127     | frontier (quality) — borderline real-time on CPU |

## Findings

1. **No model reaches WER ≤5% even on clean speech.** The "95%" target
   cannot mean raw-ASR WER — it must mean the final pipeline output
   (post-cleanup, physician-approved). Validates the 4-stage eval design.
2. **Errors cluster on clinical terms, not function words.** Every
   model — including turbo — produced `dipirona→"de pirona"`,
   `dispneia→"displeia"/"display-a"`, `Solicito→"Solista/Solisto"`.
   turbo uniquely fixed `losartana` and `hemograma`. Entity-level
   verdicts (Jev) matter more than aggregate WER — a 12% WER can hide
   a drug-name error.
3. **Negations survived in all models** ("nega alergia", "nega febre"
   preserved verbatim) — polarity flips not observed at TTS level,
   but n=5.
4. **turbo is at/beyond the real-time boundary locally** (RTF 0.71–1.28
   across runs, ~2.7GB RSS — no headroom for the rest of the app). The
   current architecture — fast local draft + server turbo — matches
   the measured frontier. Local adapters should target base/small;
   the eval harness must measure whether cleanup recovers the
   drug-name class of error.
5. **Normalization gap confirmed live**: ASR writes `500mg`, scripts
   say "quinhentos miligramas" — digit expansion alone doesn't cover
   the `mg`/`miligramas` unit equivalence; the normalization profile
   needs unit aliases before WER numbers are trustworthy.
6. **edge-tts is viable for the local TtsPort** (~5s/sample, ~20% of
   calls needed a retry — the generator adapter must retry).

## Not measured

- Workers AI large-v3-turbo (needs CF credentials) — cloud adapter
  candidate; measure latency/cost in M2.
- Piper / other local TTS engines.
