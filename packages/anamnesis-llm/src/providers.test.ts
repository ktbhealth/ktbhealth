import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnthropicExtractor } from "./anthropic.ts";
import { extractAnamnesis, selectExtractor } from "./index.ts";
import { OpenAIExtractor } from "./openai.ts";

const MOCK_ANAMNESIS = {
	queixa_principal: { content: "Dor de cabeça", confidence: "alta" },
	hda: { content: "Há 3 dias", confidence: "alta" },
	hipoteses: { content: "Enxaqueca", confidence: "media" },
	conduta: { content: "Dipirona", confidence: "alta" },
};

describe("selectExtractor", () => {
	const envBackup = { ...process.env };

	beforeEach(() => {
		delete process.env.LLM_PROVIDER;
		delete process.env.OPENAI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OLLAMA_BASE_URL;
	});

	afterEach(() => {
		process.env = { ...envBackup };
	});

	it("defaults to heuristic when no credentials configured", () => {
		const extractor = selectExtractor();
		expect(extractor.name).toBe("heuristic");
	});

	it("selects anthropic when configured", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const extractor = selectExtractor();
		expect(extractor.name).toBe("anthropic");
	});

	it("selects openai when configured", () => {
		process.env.OPENAI_API_KEY = "sk-test";
		const extractor = selectExtractor();
		expect(extractor.name).toBe("openai");
	});

	it("prioritizes anthropic over openai when both keys present", () => {
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		process.env.OPENAI_API_KEY = "sk-test";
		const extractor = selectExtractor();
		expect(extractor.name).toBe("anthropic");
	});
});

describe("OpenAIExtractor", () => {
	const envBackup = { ...process.env };

	beforeEach(() => {
		process.env.OPENAI_API_KEY = "test-key";
	});

	afterEach(() => {
		process.env = { ...envBackup };
		vi.restoreAllMocks();
	});

	it("throws if API key missing", async () => {
		delete process.env.OPENAI_API_KEY;
		delete process.env.LLM_API_KEY;
		const extractor = new OpenAIExtractor();
		await expect(extractor.extract("paciente com dor")).rejects.toThrow("LLM_API_KEY not set");
	});

	it("parses valid JSON response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: JSON.stringify(MOCK_ANAMNESIS) } }],
				}),
			}),
		);
		const extractor = new OpenAIExtractor();
		const result = await extractor.extract("paciente com dor");
		expect(result.queixa_principal?.content).toBe("Dor de cabeça");
	});

	it("throws on HTTP error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		const extractor = new OpenAIExtractor();
		await expect(extractor.extract("paciente")).rejects.toThrow("llm api: 500");
	});

	it("handles empty choices payload", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
		const extractor = new OpenAIExtractor();
		await expect(extractor.extract("paciente")).rejects.toThrow();
	});
});

describe("AnthropicExtractor", () => {
	const envBackup = { ...process.env };

	beforeEach(() => {
		process.env.ANTHROPIC_API_KEY = "test-key";
	});

	afterEach(() => {
		process.env = { ...envBackup };
		vi.restoreAllMocks();
	});

	it("throws if API key missing", async () => {
		delete process.env.ANTHROPIC_API_KEY;
		const extractor = new AnthropicExtractor();
		await expect(extractor.extract("paciente")).rejects.toThrow("ANTHROPIC_API_KEY not set");
	});

	it("parses response correctly", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					content: [{ type: "text", text: JSON.stringify(MOCK_ANAMNESIS) }],
				}),
			}),
		);
		const extractor = new AnthropicExtractor();
		const result = await extractor.extract("paciente");
		expect(result.queixa_principal?.content).toBe("Dor de cabeça");
	});
	it("throws on HTTP error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
		const extractor = new AnthropicExtractor();
		await expect(extractor.extract("paciente")).rejects.toThrow("anthropic api: 502");
	});

	it("handles response without text content", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) }),
		);
		const extractor = new AnthropicExtractor();
		await expect(extractor.extract("paciente")).rejects.toThrow();
	});
});

describe("extractAnamnesis dispatcher", () => {
	it("runs the selected extractor and tags the engine", async () => {
		const res = await extractAnamnesis("paciente relata dor de cabeça forte");
		expect(res.engine).toBe("heuristic");
		expect(res.anamnesis).toBeDefined();
		expect(res.anamnesis.queixa_principal?.content).toBeDefined();
	});

	it("falls back to heuristic when primary extractor fails", async () => {
		process.env.OPENAI_API_KEY = "test-key";
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		const res = await extractAnamnesis("paciente relata febre");
		expect(res.engine).toBe("openai!fallback");
		expect(res.anamnesis).toBeDefined();
		delete process.env.OPENAI_API_KEY;
	});
});
