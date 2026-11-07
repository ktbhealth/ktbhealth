import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import type { Anamnesis, AnamnesisReview } from "@ktb/anamnesis";
import { AnamnesisEngine, ReviewEngine } from "@ktb/anamnesis/services";
import {
	DEFAULT_WORKERS_AI_MODEL,
	makeWorkersAiAnamnesisEngine,
	makeWorkersAiReviewEngine,
	type WorkersAiBinding,
} from "./workers-ai.ts";

const section = (content: string) => ({
	content,
	confidence: "alta" as const,
	evidence: ["evidência"],
});

const MOCK_ANAMNESIS: Anamnesis = {
	queixa_principal: section("Dor de cabeça"),
	hda: section("Há 3 dias"),
	antecedentes: section("Nega"),
	alergias: section("Nega"),
	medicamentos_em_uso: section("Nega"),
	exame_fisico: section("N/A"),
	hipoteses: section("Enxaqueca"),
	conduta: section("Dipirona"),
};

const MOCK_REVIEW: AnamnesisReview = {
	lacunas: [],
	hipoteses: [
		{
			diagnostico: "Enxaqueca",
			probabilidade: "media",
			raciocinio: "padrão típico",
			evidence: ["dor de cabeça"],
			investigar: ["exame neurológico"],
		},
	],
	sinais_de_alerta: [],
	inconsistencias: [],
};

const fakeAi = (run: WorkersAiBinding["run"]): WorkersAiBinding => ({ run });

const jsonResponse = (value: unknown) => ({ response: JSON.stringify(value) });

describe("workers-ai anamnesis engine", () => {
	it("extracts JSON from a {response} payload", async () => {
		const run = vi.fn(async () => jsonResponse(MOCK_ANAMNESIS));
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* AnamnesisEngine;
			}).pipe(Effect.provide(makeWorkersAiAnamnesisEngine(fakeAi(run), "m1"))),
		);
		const res = await Effect.runPromise(engine.extract("paciente com dor"));
		expect(res.engine).toBe("workers-ai:m1");
		expect(res.anamnesis.queixa_principal.content).toBe("Dor de cabeça");
		expect(run).toHaveBeenCalledWith(
			"m1",
			expect.objectContaining({ messages: expect.any(Array) }),
		);
	});

	it("handles string and {result} response shapes and fenced JSON", async () => {
		for (const raw of [
			JSON.stringify(MOCK_ANAMNESIS),
			{ result: `\`\`\`json\n${JSON.stringify(MOCK_ANAMNESIS)}\n\`\`\`` },
			{ response: { response: JSON.stringify(MOCK_ANAMNESIS) } },
		]) {
			const engine = await Effect.runPromise(
				Effect.gen(function* () {
					return yield* AnamnesisEngine;
				}).pipe(
					Effect.provide(
						makeWorkersAiAnamnesisEngine(
							fakeAi(async () => raw),
							"m",
						),
					),
				),
			);
			const res = await Effect.runPromise(engine.extract("t"));
			expect(res.engine).toBe("workers-ai:m");
		}
	});

	it("falls back to heuristic on run failure, bad JSON, or schema mismatch", async () => {
		for (const run of [
			vi.fn(async () => {
				throw new Error("ai down");
			}),
			vi.fn(async () => ({ response: "no json here" })),
			vi.fn(async () => jsonResponse({ wrong: true })),
			vi.fn(async () => ({})),
			vi.fn(async () => ({ response: { response: 42 } })),
			vi.fn(async () => 42),
		]) {
			const engine = await Effect.runPromise(
				Effect.gen(function* () {
					return yield* AnamnesisEngine;
				}).pipe(Effect.provide(makeWorkersAiAnamnesisEngine(fakeAi(run), "m"))),
			);
			const res = await Effect.runPromise(engine.extract("paciente relata tosse"));
			expect(res.engine).toBe("workers-ai:m!fallback");
			expect(res.anamnesis.queixa_principal.content).toBeTruthy();
		}
	});
});

describe("workers-ai review engine", () => {
	it("reviews, caches, and degrades on failure", async () => {
		const run = vi.fn(async () => jsonResponse(MOCK_REVIEW));
		const layer = makeWorkersAiReviewEngine(fakeAi(run), "rm");
		const engine = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(Effect.provide(layer)),
		);
		const first = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(first.review).not.toBeNull();
		expect(first.review !== null && first.engine).toBe("workers-ai:rm");
		const second = await Effect.runPromise(engine.review("t", MOCK_ANAMNESIS));
		expect(run).toHaveBeenCalledTimes(1);
		expect(second.review).not.toBeNull();

		const bad = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(
				Effect.provide(
					makeWorkersAiReviewEngine(
						fakeAi(async () => {
							throw new Error("boom");
						}),
						"rm",
					),
				),
			),
		);
		const degraded = await Effect.runPromise(bad.review("t2", MOCK_ANAMNESIS));
		expect(degraded.review === null && degraded.reason).toContain("Segunda opinião falhou");

		const degradedBadJson = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(
				Effect.provide(
					makeWorkersAiReviewEngine(
						fakeAi(async () => ({ response: "junk" })),
						"rm",
					),
				),
			),
		);
		const res = await Effect.runPromise(degradedBadJson.review("t4", MOCK_ANAMNESIS));
		expect(res.review === null && res.reason).toContain("Segunda opinião falhou");

		const badRaw = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ReviewEngine;
			}).pipe(
				Effect.provide(
					makeWorkersAiReviewEngine(
						fakeAi(async () => {
							throw "raw failure";
						}),
						"rm",
					),
				),
			),
		);
		const degradedRaw = await Effect.runPromise(badRaw.review("t3", MOCK_ANAMNESIS));
		expect(degradedRaw.review === null && degradedRaw.reason).toContain("raw failure");
	});
});

describe("workers-ai config surface", () => {
	it("default model constant is a workers-ai model id", () => {
		expect(DEFAULT_WORKERS_AI_MODEL).toMatch(/^@cf\//);
	});
});
