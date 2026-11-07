# anamnese

> Capture, transcribe, and manage teleconsultations — scalably and cheaply.

## Problem

Brazilian doctors spend ~40% of a consultation documenting instead of
listening. Poorly recorded anamnesis means clinical errors, legal
exposure, and a 15-minute consult turning into 25 minutes of typing.
Existing EMRs make it worse — the physician types looking at the
screen, not the patient.

## Solution

Ambient scribe for telemedicine: the app captures the consultation
audio → transcribes (PT-BR, Whisper) → structures a clinical anamnesis
(chief complaint, HPI, history, physical exam, hypotheses, plan) → the
doctor reviews and approves → export to the medical record.

The AI drafts; the physician decides. It supports clinical
documentation — it does not diagnose or prescribe.

## Running the PoC

The proof-of-concept (app, transcription pipeline, audio capture
spikes) lives on the [`poc`](https://github.com/luisfuturist/tool-telemedicine-transcription/tree/poc) branch:

```bash
git checkout poc
pnpm install

# .env.local — at minimum an LLM provider + database:
#   LLM_API_KEY, LLM_BASE_URL, LLM_MODEL   (OpenAI-compatible endpoint)
#   DATABASE_URL                           (Postgres, drizzle-kit db:push)

pnpm dev   # http://localhost:3000
```

## Status

Exploration in progress — active roadmap, ADRs, and backlog live under
[`project/`](project/) on the `project` branch.
