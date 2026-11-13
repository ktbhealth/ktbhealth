# @ktb/eval-dataset-stub

Deterministic, zero-I/O adapters for every `@ktb/eval-dataset` port.
Used by unit tests and the default CI path — the expensive suite
(real TTS/ASR/Jev) stays opt-in.

## Usage

```ts
const { layer, records } = makeStubLayer({
	asr: { text: "custom transcript" }, // optional fixture overrides
	audio: { uri: "stub://x", size: 4, durationMs: 100 },
	script: "custom script",
	answers: [{ id: "q", kind: "noul", value: true, probability: 0.9 }],
});

await Effect.runPromise(Effect.provide(processSample({ sample }), layer));
// records: every RunRecord emitted by the canned adapters
```

Canned behavior: ASR returns a script-shaped transcript, LLM applies a
single `"cabeca"→"cabeça"` flagged edit, the judge answers every
question with probability 0.95, store keeps samples in memory, report
collects records in memory.
