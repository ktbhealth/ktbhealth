import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { makeDb, type DbClient } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { consultations } from "@ktb/db/schema";
import { attachAudioRecord, createConsultation } from "@ktb/consultations";

import {
	bytesToBase64,
	extractWhisperText,
	handleAudioQueueBatch,
	MAX_AUDIO_BYTES,
	processAudioJob,
	transcribeAudio,
	whisperInputs,
	type AudioJobDeps,
	type AudioJobMessage,
	type QueueMessageLike,
} from "./audio-jobs.ts";

const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, patient_id INTEGER, transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL DEFAULT 'browser', status TEXT NOT NULL DEFAULT 'done', bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL);
`;

const makeDeps = (over: Partial<AudioJobDeps> = {}) => {
	const db = makeDb(makeD1(DDL));
	const calls = { corrected: [] as string[] };
	const deps: AudioJobDeps = {
		db,
		bucket: {
			get: async (key) => {
				const objects: Record<string, { size: number; data: Uint8Array }> = {
					"audio/u1/1/a.webm": { size: 3, data: new Uint8Array([1, 2, 3]) },
				};
				const o = objects[key];
				if (!o) return null;
				const bytes = o.data.slice();
				return { size: o.size, arrayBuffer: async () => bytes.buffer };
			},
		},
		ai: { run: async () => ({ text: "transcrição servidor" }) },
		correctTranscript: async (t) => {
			calls.corrected.push(t);
			return { corrected: `${t} (corrigido)`, engine: "test-llm" };
		},
		...over,
	};
	return { db, deps, calls };
};

const job = (consultationId: number, over: Partial<AudioJobMessage> = {}): AudioJobMessage => ({
	consultationId,
	audioKey: "audio/u1/1/a.webm",
	userId: "u1",
	...over,
});

const row = async (db: DbClient, id: number) =>
	(await db.select().from(consultations).where(eq(consultations.id, id)))[0];

describe("audio-jobs pure helpers", () => {
	it("bytesToBase64 round-trips", () => {
		const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
		expect(atob(bytesToBase64(bytes))).toBe("hello");
	});

	it("whisperInputs sends base64 audio with pt language", () => {
		expect(whisperInputs("QUJD")).toEqual({ audio: "QUJD", language: "pt" });
	});

	it("extractWhisperText tolerates shapes", () => {
		expect(extractWhisperText({ text: "oi" })).toBe("oi");
		expect(extractWhisperText({ transcription: "alt" })).toBe("alt");
		expect(extractWhisperText("raw")).toBe("raw");
		expect(() => extractWhisperText({ nope: 1 })).toThrow("unrecognized");
		expect(() => extractWhisperText(null)).toThrow("unrecognized");
		expect(() => extractWhisperText(42)).toThrow("unrecognized");
	});

	it("transcribeAudio calls the large-v3-turbo model", async () => {
		const seen: { model?: string; inputs?: unknown } = {};
		const ai = {
			run: async (model: string, inputs: unknown) => {
				seen.model = model;
				seen.inputs = inputs;
				return { text: "fala" };
			},
		};
		const text = await transcribeAudio(ai, new Uint8Array([65, 66]));
		expect(text).toBe("fala");
		expect(seen.model).toBe("@cf/openai/whisper-large-v3-turbo");
		expect((seen.inputs as { audio: string }).audio).toBeTruthy();
	});
});

describe("processAudioJob", () => {
	it("transcribes, stores server transcript and runs LLM cleanup", async () => {
		const { db, deps, calls } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });

		await processAudioJob(job(id), deps);

		const r = await row(db, id);
		expect(r?.audioStatus).toBe("done");
		expect(r?.serverTranscript).toBe("transcrição servidor");
		expect(r?.correctedTranscript).toBe("transcrição servidor (corrigido)");
		expect(r?.enhancementEngine).toBe("test-llm");
		expect(calls.corrected).toEqual(["transcrição servidor"]);
	});

	it("is idempotent — done consultations are skipped", async () => {
		const { db, deps } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id), deps);
		await processAudioJob(job(id), deps); // redelivery
		const r = await row(db, id);
		expect(r?.serverTranscript).toBe("transcrição servidor");
	});

	it("marks failed when the audio object is missing", async () => {
		const { db, deps } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/missing.webm", size: 3 });
		await processAudioJob(job(id), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("failed");
		expect(r?.audioError).toContain("missing");
	});

	it("marks failed on oversized audio without calling the model", async () => {
		const { db, deps } = makeDeps({
			bucket: {
				get: async () => ({
					size: MAX_AUDIO_BYTES + 1,
					arrayBuffer: async () => new ArrayBuffer(0),
				}),
			},
			ai: {
				run: async () => {
					throw new Error("should not be called");
				},
			},
		});
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("failed");
		expect(r?.audioError).toContain("too large");
	});

	it("marks failed on owner mismatch and on AI errors", async () => {
		const { db, deps } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id, { userId: "u2" }), deps);
		expect((await row(db, id))?.audioError).toContain("mismatch");

		const failing = makeDeps({
			db,
			ai: {
				run: async () => {
					throw new Error("ai down");
				},
			},
		});
		const id2 = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id2, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id2), failing.deps);
		const r2 = await row(db, id2);
		expect(r2?.audioStatus).toBe("failed");
		expect(r2?.audioError).toContain("ai down");
	});

	it("publishes live audio updates for the jobs feed", async () => {
		const updates: { consultationId: number; audioStatus: string; audioError: string | null }[] =
			[];
		const { db, deps } = makeDeps({
			publishAudioUpdate: async (u) => {
				updates.push(u);
			},
		});
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });

		await processAudioJob(job(id), deps);
		expect(updates).toEqual([
			{ consultationId: id, audioStatus: "processing", audioError: null },
			{ consultationId: id, audioStatus: "done", audioError: null },
		]);
	});

	it("publishes the failure reason and survives a broken publisher", async () => {
		const updates: { audioStatus: string; audioError: string | null }[] = [];
		const { db, deps } = makeDeps({
			publishAudioUpdate: async (u) => {
				updates.push(u);
			},
		});
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/missing.webm", size: 3 });
		await processAudioJob(job(id), deps);
		expect(updates.at(-1)).toMatchObject({ audioStatus: "failed" });
		expect(updates.at(-1)?.audioError).toContain("missing");

		// A rejecting publisher must not fail the job.
		const { db: db2, deps: deps2 } = makeDeps({
			publishAudioUpdate: async () => {
				throw new Error("bus down");
			},
		});
		const id2 = (await createConsultation(db2, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db2, id2, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id2), deps2);
		expect((await row(db2, id2))?.audioStatus).toBe("done");
	});

	it("falls back to the job's audio key when the row has none", async () => {
		const { db, deps } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await processAudioJob(job(id), deps);
		expect((await row(db, id))?.audioStatus).toBe("done");
	});

	it("marks failed when neither the row nor the job carries an audio key", async () => {
		const { db, deps } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await processAudioJob(job(id, { audioKey: "" }), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("failed");
		expect(r?.audioError).toBe("no audio key recorded");
	});

	it.each([
		["bucket", { bucket: undefined }],
		["ai binding", { ai: undefined }],
	] as const)("marks failed when the %s is not configured", async (_name, over) => {
		const { db, deps } = makeDeps(over);
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("failed");
		expect(r?.audioError).toBe("audio pipeline not configured");
	});

	it("marks failed when the transcription comes back empty", async () => {
		const { db, deps, calls } = makeDeps({ ai: { run: async () => ({ text: "   " }) } });
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("failed");
		expect(r?.audioError).toBe("transcription returned empty text");
		expect(calls.corrected).toEqual([]);
	});

	it("keeps only the original transcript when cleanup yields nothing", async () => {
		const { db, deps } = makeDeps({ correctTranscript: async () => null });
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("done");
		expect(r?.correctedTranscript).toBeNull();
	});

	it("keeps status done when LLM cleanup fails", async () => {
		const { db, deps } = makeDeps({
			correctTranscript: async () => {
				throw new Error("llm down");
			},
		});
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		await processAudioJob(job(id), deps);
		const r = await row(db, id);
		expect(r?.audioStatus).toBe("done");
		expect(r?.correctedTranscript).toBeNull();
	});
});

describe("handleAudioQueueBatch", () => {
	const msg = (body: unknown, log: string[]): QueueMessageLike => ({
		body,
		ack: () => log.push("ack"),
		retry: () => log.push("retry"),
	});

	it("acks valid jobs and poison messages, retries on unexpected errors", async () => {
		const { db, deps } = makeDeps();
		const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "audio/u1/1/a.webm", size: 3 });
		const log: string[] = [];
		await handleAudioQueueBatch(
			[
				msg(job(id), log),
				msg({ bogus: true }, log),
				msg(job(99999), log), // missing consultation → marked failed, acked
			],
			deps,
		);
		expect(log).toEqual(["ack", "ack", "ack"]);
		expect((await row(db, id))?.audioStatus).toBe("done");
	});

	it("retries when processing throws unexpectedly", async () => {
		const { deps } = makeDeps({
			db: {
				// break audioJobRecord's first query
			} as unknown as DbClient,
		});
		const log: string[] = [];
		await handleAudioQueueBatch([msg(job(1), log)], deps);
		expect(log).toEqual(["retry"]);
	});
});
