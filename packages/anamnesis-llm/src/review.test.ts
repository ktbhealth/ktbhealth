import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_TRANSCRIPT } from "@ktb/anamnesis";
import { HeuristicExtractor } from "@ktb/anamnesis";
import {
	clearReviewCache,
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
	beforeEach(async () => {
		await clearReviewCache();
	});
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

	it("normalise keeps valid secao, tolerates non-array and null", () => {
		const r = normalizeReview({
			lacunas: [
				{ secao: "alergias", o_que_falta: "penicilina?", pergunta_sugerida: "?", motivo: "m" },
			],
			inconsistencias: "not-an-array",
		});
		expect(r.lacunas[0]?.secao).toBe("alergias");
		expect(r.inconsistencias).toEqual([]);
		expect(normalizeReview(null).lacunas).toEqual([]);
	});

	it("anthropic response without text content degrades", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "anthropic");
		vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ content: [{ type: "tool_use" }] }),
			}),
		);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/Segunda opinião falhou/);
	});

	it("parses fenced JSON", () => {
		const r = parseReview('```json\n{"hipoteses":[{"diagnostico":"Sinusite"}]}\n```');
		expect(r.hipoteses[0]?.diagnostico).toBe("Sinusite");
	});

	it("falls back to local Ollama (no key) and explains when it is down", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "");
		vi.stubEnv("LLM_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
		expect(selectReviewProvider()).toBe("ollama");
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/ollama serve/);
	});

	it("uses Ollama with a JSON schema, thinking off, and parses the result", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "ollama");
		vi.stubEnv("REVIEW_MODEL", "");
		const fetchMock = vi
			.fn<(url: string, init: { body: string }) => Promise<unknown>>()
			.mockResolvedValue({
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
			vi
				.fn<(url: string, init: { body: string }) => Promise<unknown>>()
				.mockResolvedValue({ ok: false, status: 404 }),
		);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect("reason" in r && r.reason).toMatch(/ollama pull qwen3:8b/);
	});

	it("ollama non-404 HTTP error throws into degrade path", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "ollama");
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/ollama api: 500/);
	});

	it("ollama response without message content parses empty", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "ollama");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: {} }) }),
		);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/Segunda opinião falhou/);
	});

	it("selectReviewProvider picks openai via LLM_API_KEY or OPENAI_API_KEY", () => {
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubEnv("ANTHROPIC_API_KEY", "");
		vi.stubEnv("LLM_API_KEY", "k1");
		vi.stubEnv("OPENAI_API_KEY", "");
		expect(selectReviewProvider()).toBe("openai");
		delete process.env.LLM_API_KEY;
		vi.stubEnv("OPENAI_API_KEY", "k2");
		expect(selectReviewProvider()).toBe("openai");
		vi.stubEnv("OPENAI_API_KEY", "");
		expect(selectReviewProvider()).toBe("ollama");
	});

	it("calls the Anthropic review model and returns the parsed review", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubEnv("ANTHROPIC_API_KEY", "k");
		vi.stubEnv("REVIEW_MODEL", "modelo-x");
		const fetchMock = vi
			.fn<(url: string, init: { body: string }) => Promise<unknown>>()
			.mockResolvedValue({
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

	it("calls the OpenAI review model and returns the parsed review", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "openai");
		vi.stubEnv("OPENAI_API_KEY", "sk-openai-key");
		vi.stubEnv("REVIEW_MODEL", "gpt-4o");
		const fetchMock = vi
			.fn<(url: string, init: { body: string }) => Promise<unknown>>()
			.mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									hipoteses: [
										{
											diagnostico: "Enxaqueca clássica",
											probabilidade: "alta",
											evidence: ["fotofobia"],
										},
									],
								}),
							},
						},
					],
				}),
			});
		vi.stubGlobal("fetch", fetchMock);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review?.hipoteses[0]?.diagnostico).toBe("Enxaqueca clássica");
		expect("engine" in r && r.engine).toBe("openai:gpt-4o");
	});

	it("openai review degrades when API fails and handles empty choices", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "openai");
		vi.stubEnv("LLM_API_KEY", "sk-llm");
		vi.stubEnv("LLM_BASE_URL", "http://llm.local/v1");
		const fetchMock = vi
			.fn<(url: string, init: { body: string }) => Promise<unknown>>()
			.mockResolvedValueOnce({ ok: false, status: 502 })
			.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
		vi.stubGlobal("fetch", fetchMock);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r1 = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r1.review).toBeNull();
		expect("reason" in r1 && r1.reason).toMatch(/502/);
		const r2 = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r2.review).toBeNull();
		expect(fetchMock.mock.calls[0][0]).toBe("http://llm.local/v1/chat/completions");
	});

	it("degrades with String(e) when a non-Error is thrown", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "openai");
		vi.stubEnv("OPENAI_API_KEY", "k");
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue("boom"));
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/boom/);
	});

	it("caches successful reviews: same input hits fetch once", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "openai");
		vi.stubEnv("OPENAI_API_KEY", "k");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [
					{
						message: {
							content: JSON.stringify({
								lacunas: [],
								hipoteses: [],
								sinais_de_alerta: [],
								inconsistencias: [],
							}),
						},
					},
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r1 = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		const r2 = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r1.review).not.toBeNull();
		expect(r2).toEqual(r1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("expires cached reviews after the TTL", async () => {
		vi.useFakeTimers();
		try {
			vi.stubEnv("REVIEW_PROVIDER", "openai");
			vi.stubEnv("OPENAI_API_KEY", "k");
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									lacunas: [],
									hipoteses: [],
									sinais_de_alerta: [],
									inconsistencias: [],
								}),
							},
						},
					],
				}),
			});
			vi.stubGlobal("fetch", fetchMock);
			const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
			await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
			vi.setSystemTime(Date.now() + 6 * 60_000);
			await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not cache degraded results", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "openai");
		vi.stubEnv("OPENAI_API_KEY", "k");
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
		vi.stubGlobal("fetch", fetchMock);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("degrades to a reason (never throws) when the API fails", async () => {
		vi.stubEnv("REVIEW_PROVIDER", "");
		vi.stubEnv("ANTHROPIC_API_KEY", "k");
		vi.stubGlobal(
			"fetch",
			vi
				.fn<(url: string, init: { body: string }) => Promise<unknown>>()
				.mockResolvedValue({ ok: false, status: 500 }),
		);
		const a = await new HeuristicExtractor().extract(SAMPLE_TRANSCRIPT);
		const r = await reviewAnamnesis(SAMPLE_TRANSCRIPT, a);
		expect(r.review).toBeNull();
		expect("reason" in r && r.reason).toMatch(/500/);
	});
});
