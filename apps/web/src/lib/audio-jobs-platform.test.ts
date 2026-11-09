import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachAudioRecord, createConsultation } from "@ktb/consultations";
import { consultations } from "@ktb/db/schema";
import { audioBucketStore } from "#/test/cloudflare-workers.ts";

const correct = vi.hoisted(() => vi.fn());

// Real platform composition (db, bucket + ai doubles, runtime) — only the
// LLM cleanup is replaced so each outcome can be forced.
vi.mock("#/lib/platform.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/platform.ts")>()),
	correctTranscript: (t: string) => correct(t),
}));

import { db } from "#/lib/platform.ts";
import { handleAudioQueueBatch, type QueueMessageLike } from "./audio-jobs.ts";

const AUDIO_KEY = "audio/u1/1/platform.webm";

const seed = async () => {
	const id = (await createConsultation(db, { userId: "u1", source: "browser" }))!;
	audioBucketStore.set(AUDIO_KEY, { data: new Uint8Array([1, 2, 3]) });
	await attachAudioRecord(db, id, { audioKey: AUDIO_KEY, size: 3 });
	return id;
};

const row = async (id: number) =>
	(await db.select().from(consultations).where(eq(consultations.id, id)))[0];

const message = (id: number, log: string[]): QueueMessageLike => ({
	body: { consultationId: id, audioKey: AUDIO_KEY, userId: "u1" },
	ack: () => log.push("ack"),
	retry: () => log.push("retry"),
});

beforeEach(() => {
	correct.mockReset();
});

describe("handleAudioQueueBatch with the platform deps", () => {
	it("transcribes with the bound bucket and ai, then stores the cleaned transcript", async () => {
		correct.mockResolvedValue({ corrected: "Transcrição corrigida.", engine: "test-llm" });
		const id = await seed();
		const log: string[] = [];
		await handleAudioQueueBatch([message(id, log)]);
		expect(log).toEqual(["ack"]);
		expect(correct).toHaveBeenCalledWith("transcrição do servidor");
		const r = await row(id);
		expect(r?.audioStatus).toBe("done");
		expect(r?.serverTranscript).toBe("transcrição do servidor");
		expect(r?.correctedTranscript).toBe("Transcrição corrigida.");
	});

	it("treats a failing cleanup as no correction instead of failing the job", async () => {
		correct.mockRejectedValue(new Error("llm down"));
		const id = await seed();
		const log: string[] = [];
		await handleAudioQueueBatch([message(id, log)]);
		expect(log).toEqual(["ack"]);
		const r = await row(id);
		expect(r?.audioStatus).toBe("done");
		expect(r?.correctedTranscript).toBeNull();
	});
});
