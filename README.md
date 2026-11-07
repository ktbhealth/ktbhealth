# KTB

> Clinical Intelligence: turning medical conversations into lasting
> clinical knowledge.

KTB is a SaaS platform for doctors that captures, transcribes,
organizes, and manages medical consultation conversations, reducing
the administrative burden of clinical documentation while preserving
the information generated during patient care.

## Problem

Brazilian doctors spend ~40% of a consultation documenting instead of
listening. Poorly recorded anamnesis means clinical errors, legal
exposure, and a 15-minute consult turning into 25 minutes of typing.
Existing EMRs make it worse: the physician types looking at the
screen, not the patient.

## Solution

Ambient scribe for telemedicine: the app captures the consultation
audio → transcribes (PT-BR, Whisper) → structures a clinical anamnesis
(chief complaint, HPI, history, physical exam, hypotheses, plan) → the
doctor reviews and approves → export to the medical record.

The AI drafts; the physician decides. It supports clinical
documentation; it does not diagnose or prescribe.

## The name

KTB comes from the Arabic root ك ت ب (K-T-B), associated with writing,
books, and documentation: writing down what matters, preserving
knowledge, and turning conversations into structured records that stay
accessible over time.

## Vision

Beyond transcription: an intelligent layer for clinical information,
connecting consultations, documentation, and patient history into a
more useful and continuous clinical workflow.

## Running the PoC

```bash
pnpm install

# .env.local - at minimum an LLM provider + database:
#   LLM_API_KEY, LLM_BASE_URL, LLM_MODEL   (OpenAI-compatible endpoint)
#   DATABASE_URL                           (Postgres, drizzle-kit db:push)

pnpm dev   # http://localhost:3000
```

## Status

Exploration in progress. active roadmap, ADRs, and backlog live on the
[`project`](https://github.com/ktbhealth/ktbhealth/tree/project) branch.
