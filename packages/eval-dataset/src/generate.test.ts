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
				getBlob: () => Effect.succeed(null),
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
	return { layer, stored, appended };
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
		expect(s.status).toBe("pending");
		expect(s.audio?.uri).toContain("stub://a-");
		expect(s.gold.entities?.map((e) => e.category)).toContain("medication");
		expect(s.scriptHash).toBe(fnvHex(s.script));
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
});
