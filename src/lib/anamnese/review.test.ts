import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_TRANSCRIPT } from "#/lib/sample.ts";
import { HeuristicExtractor } from "./heuristic.ts";
import {
	normalizeReview,
	parseReview,
	reviewAnamnesis,
	selectReviewProvider,
} from "./review.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("review", () => {
	it("normalises sloppy model output instead of crashing", () => {
		const r = normalizeReview({
			lacunas: [
				{
					secao: "inexistente",
					o_que_falta: "duração",
					pergunta_sugerida: "?",
				},
				{ o_que_falta: "", pergunta_sugerida: "" },
			],
			hipoteses: [
				{ diagnostico: "Enxaqueca", probabilidade: "muito", evidence: "x" },
				{ diagnostico: "" },
			],
			sinais_de_alerta: ["rigidez de nuca", 3],
		});
		expect(r.lacunas).toHaveLength(1);
		expect(r.lacunas[0]?.secao).toBe("hda");
		expect(r.hipoteses).toHaveLength(1);
		expect(r.hipoteses[0]?.probabilidade).toBe("baixa");
		expect(r.hipoteses[0]?.evidence).toEqual([]);
		expect(r.sinais_de_alerta).toEqual(["rigidez de nuca"]);
		expect(r.inconsistencias).toEqual([]);
	});

	it("parses fenced JSON", () => {
		const r = parseReview(
			'```json\n{"hipoteses":[{"diagnostico":"Sinusite"}]}\n```',
		);
		expect(r.hipoteses[0]?.diagnostico).toBe("Sinusite");
	});

	it("falls back to local Ollama (no key) and explains when it is down", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "");
		vi.stubEnv("LLM_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
		);
		expect(selectReviewProvider()).toBe("ollama");
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/ollama serve/);
	});

	it("uses Ollama with a JSON schema, thinking off, and parses the result", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "ollama");
		vi.stubEnv("REVIEW_MODEL", "");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				message: {
					content: JSON.stringify({
						lacunas: [],
						hipoteses: [
							{
								diagnostico: "Cefaleia tensional",
								probabilidade: "media",
								evidence: [],
								investigar: [],
							},
						],
						sinais_de_alerta: [],
						inconsistencias: [],
					}),
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review?.hipoteses[0]?.diagnostico).toBe("Cefaleia tensional");
		expect("engine" in r && r.engine).toBe("ollama:qwen3:8b");
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("http://localhost:11434/api/chat");
		const body = JSON.parse(init.body);
		expect(body.think).toBe(false);
		expect(body.format.required).toContain("hipoteses");
	});

	it("tells the user to pull the model when Ollama returns 404", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "ollama");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect("reason" in r && r.reason).toMatch(/ollama pull qwen3:8b/);
	});

	it("calls the Anthropic review model and returns the parsed review", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubEnv("ANTHROPIC_API_KEY", "k");
		vi.stubEnv("REVIEW_MODEL", "modelo-x");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							hipoteses: [
								{
									diagnostico: "Meningite",
									probabilidade: "media",
									evidence: ["febre"],
								},
							],
						}),
					},
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review?.hipoteses[0]?.diagnostico).toBe("Meningite");
		expect("engine" in r && r.engine).toBe("anthropic:modelo-x");
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.model).toBe("modelo-x");
		expect(body.messages[0].content).toContain(SAMPLE_TRANSCRIPT);
	});

	it("degrades to a reason (never throws) when the API fails", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubEnv("ANTHROPIC_API_KEY", "k");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/500/);
	});
});
