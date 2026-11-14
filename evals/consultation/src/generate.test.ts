import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { describe, expect, it } from "vitest";

import { generateDataset, fnvHex, type GenerateInput } from "./generate.ts";
import { DEFAULT_MATRIX, expandPersonaMatrix } from "./personas.ts";
import { DatasetStorePort, PortError, ReportPort, TtsPort } from "./ports.ts";
import type { RunRecord, Sample } from "./schema.ts";

const record: RunRecord = {
	runId: "r",
	taskId: "v",
	stage: "synthesize",
	engine: "stub-tts",
	inputHash: "h",
	startedAt: 0,
};

const TEMPLATE = "<%= it.slots.greeting %>\n<%= it.slots.chief_complaint %>";

const makeLayer = (opts?: { failOnVoice?: string; failStore?: boolean }) => {
	const stored: Sample[] = [];
	const appended: RunRecord[] = [];
	const blobMetaCalls: { uri: string; origin?: string }[] = [];
	const layer = Layer.mergeAll(
		Layer.succeed(
			TtsPort,
			TtsPort.of({
				synthesize: ({ voiceId }) =>
					voiceId === opts?.failOnVoice
						? Effect.fail(new PortError({ port: "tts", message: "engine down" }))
						: Effect.succeed({ audio: { uri: `stub://a-${voiceId}`, size: 8 }, record }),
			}),
		),
		Layer.succeed(
			DatasetStorePort,
			DatasetStorePort.of({
				putSample: (s) =>
					opts?.failStore === true
						? Effect.fail(new PortError({ port: "store", message: "read-only" }))
						: Effect.sync(() => void stored.push(s)),
				getSample: () => Effect.succeed(null),
				listSamples: () => Effect.succeed([]),
				putBlob: () => Effect.void,
				putBlobMeta: (uri, meta) =>
					Effect.sync(() => void blobMetaCalls.push({ uri, origin: meta?.origin })),
				getBlob: () => Effect.succeed(null),
				getBlobMeta: () => Effect.succeed(null),
				putResult: () => Effect.void,
				listResults: () => Effect.succeed([]),
			}),
		),
		Layer.succeed(
			ReportPort,
			ReportPort.of({
				append: (r) => Effect.sync(() => void appended.push(r)),
				render: () => Effect.succeed(""),
			}),
		),
	);
	return { layer, stored, appended, blobMetaCalls };
};

const personas = expandPersonaMatrix(DEFAULT_MATRIX).slice(0, 4);

const input = (over?: Partial<GenerateInput>): GenerateInput => ({
	datasetVersion: "v-test",
	personas,
	template: TEMPLATE,
	acoustic: (_p, i) => ({
		ttsModel: "edge",
		voiceId: i % 2 === 0 ? "br_male_1" : "br_female_1",
		noise: "clean",
		sampleRate: 16000,
	}),
	seed: 100,
	...over,
});

describe("generateDataset", () => {
	it("produces manifests with gold entities, audio and records", async () => {
		const { layer, stored, appended } = makeLayer();
		const r = await Effect.runPromise(Effect.provide(generateDataset(input()), layer));
		expect(r.ok).toHaveLength(4);
		expect(stored).toHaveLength(4);
		expect(appended).toHaveLength(4);
		const s = stored[0]!;
		expect(s.origin).toBe("synthetic");
		expect(s.audio?.uri).toContain("stub://a-");
		expect(s.gold.entities?.map((e) => e.category)).toContain("medication");
		expect(s.scriptHash).toBe(fnvHex(s.script));
	});

	it("registers synthetic blob provenance for every produced audio (M1)", async () => {
		const { layer, stored, blobMetaCalls } = makeLayer();
		await Effect.runPromise(Effect.provide(generateDataset(input()), layer));
		expect(blobMetaCalls).toHaveLength(4);
		expect(blobMetaCalls.every((c) => c.origin === "synthetic")).toBe(true);
		// Concurrency may interleave — compare as sets.
		expect(new Set(blobMetaCalls.map((c) => c.uri))).toEqual(
			new Set(stored.map((s) => s.audio!.uri)),
		);
	});

	it("is deterministic — same seed → same ids and scripts", async () => {
		const a = makeLayer();
		const b = makeLayer();
		await Effect.runPromise(Effect.provide(generateDataset(input()), a.layer));
		await Effect.runPromise(Effect.provide(generateDataset(input()), b.layer));
		expect(a.stored.map((s) => s.id)).toEqual(b.stored.map((s) => s.id));
		expect(a.stored.map((s) => s.script)).toEqual(b.stored.map((s) => s.script));
	});

	it("isolates a TTS failure — siblings still persist", async () => {
		const { layer, stored } = makeLayer({ failOnVoice: "br_female_1" });
		const r = await Effect.runPromise(Effect.provide(generateDataset(input()), layer));
		expect(r.ok).toHaveLength(2);
		expect(r.failed).toHaveLength(2);
		expect(stored).toHaveLength(2);
		expect(r.outcomes.every((o) => o.status !== "ok" || o.value?.sample.audio !== undefined)).toBe(
			true,
		);
	});

	it("retries a flaky engine via batch options", async () => {
		let calls = 0;
		const tts = TtsPort.of({
			synthesize: () =>
				Effect.suspend(() =>
					++calls === 1
						? Effect.fail(new PortError({ port: "tts", message: "flaky" }))
						: Effect.succeed({ audio: { uri: "stub://x" }, record }),
				),
		});
		const { layer } = makeLayer();
		const r = await Effect.runPromise(
			Effect.provide(
				generateDataset(input({ batch: { retry: Schedule.recurs(1) } })),
				Layer.merge(layer, Layer.succeed(TtsPort, tts)),
			),
		);
		expect(r.ok).toHaveLength(4);
	});

	it("surfaces store failures as typed outcomes", async () => {
		const { layer } = makeLayer({ failStore: true });
		const r = await Effect.runPromise(Effect.provide(generateDataset(input()), layer));
		expect(r.failed).toHaveLength(4);
		expect(r.outcomes[0]?.error?.message).toBe("read-only");
	});

	it("defaults the seed to 0 when omitted", async () => {
		const a = makeLayer();
		const b = makeLayer();
		await Effect.runPromise(Effect.provide(generateDataset(input({ seed: undefined })), a.layer));
		await Effect.runPromise(Effect.provide(generateDataset(input({ seed: 0 })), b.layer));
		expect(a.stored.map((s) => s.id)).toEqual(b.stored.map((s) => s.id));
	});

	it("empty persona list yields an empty batch", async () => {
		const { layer } = makeLayer();
		const r = await Effect.runPromise(
			Effect.provide(generateDataset(input({ personas: [] })), layer),
		);
		expect(r.ok).toEqual([]);
	});

	it("stamps runId, sampleId and datasetVersion on report records", async () => {
		const { layer, appended } = makeLayer();
		const r = await Effect.runPromise(
			Effect.provide(generateDataset(input({ runId: "gen-test-1" })), layer),
		);
		expect(r.ok).toHaveLength(4);
		expect(appended).toHaveLength(4);
		for (const rec of appended) {
			expect(rec.runId).toBe("gen-test-1");
			expect(rec.sampleId).toMatch(/^s-/);
			expect(rec.datasetVersion).toBe("v-test");
		}
		expect(new Set(appended.map((a) => a.sampleId)).size).toBe(4);
	});

	it("surfaces a malformed template as a typed per-item failure", async () => {
		const { layer, stored } = makeLayer();
		const r = await Effect.runPromise(
			Effect.provide(generateDataset(input({ template: "<% if ( %>" })), layer),
		);
		expect(r.ok).toHaveLength(0);
		expect(r.failed).toHaveLength(4);
		expect(stored).toHaveLength(0);
		expect(r.outcomes[0]?.error).toBeInstanceOf(PortError);
		expect(r.outcomes[0]?.error?.message).toBe("script render failed");
	});

	it("surfaces a throwing acoustic callback as a typed per-item failure", async () => {
		const { layer, stored } = makeLayer();
		const r = await Effect.runPromise(
			Effect.provide(
				generateDataset(
					input({
						acoustic: () => {
							throw new Error("bad voice");
						},
					}),
				),
				layer,
			),
		);
		expect(r.ok).toHaveLength(0);
		expect(r.failed).toHaveLength(4);
		expect(stored).toHaveLength(0);
		expect(r.outcomes[0]?.error).toBeInstanceOf(PortError);
		expect(r.outcomes[0]?.error?.message).toBe("acoustic profile failed");
	});

	it("template and voice feed the sample id", async () => {
		const a = makeLayer();
		const b = makeLayer();
		await Effect.runPromise(Effect.provide(generateDataset(input()), a.layer));
		await Effect.runPromise(
			Effect.provide(
				generateDataset(input({ template: `${TEMPLATE}\n<!-- variant -->` })),
				b.layer,
			),
		);
		expect(a.stored.map((s) => s.id)).not.toEqual(b.stored.map((s) => s.id));
	});

	it("personas differing only in optional fields get distinct ids (M7)", async () => {
		const base = personas[0]!;
		const { layer, stored } = makeLayer();
		const r = await Effect.runPromise(
			Effect.provide(
				generateDataset(
					input({
						personas: [base, { ...base, gender: "female" }, { ...base, cues: ["soft voice"] }],
					}),
				),
				layer,
			),
		);
		expect(r.ok).toHaveLength(3);
		expect(new Set(stored.map((s) => s.id)).size).toBe(3);
	});
});
