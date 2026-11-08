import { describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("cloudflare:workers", () => ({
	env: {
		DB: {},
		AI: { run: vi.fn() },
		BETTER_AUTH_SECRET: "x".repeat(32),
		BETTER_AUTH_URL: "http://localhost:3000",
	},
}));
vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

import { novaApi } from "./new.tsx";

describe("novaApi wiring", () => {
	const sec = { content: "x", confidence: "media" as const, evidence: [] as string[] };
	const ANAMNESIS = {
		queixa_principal: sec,
		hda: sec,
		antecedentes: sec,
		alergias: sec,
		medicamentos_em_uso: sec,
		exame_fisico: sec,
		hipoteses: sec,
		conduta: sec,
	};

	it("delegates every server fn", async () => {
		// anonymous: fns return empty results or throw; arrows still execute
		await expect(novaApi.getLiveConsultation({ data: 1 })).resolves.toBeNull();
		await expect(novaApi.extractAnamnese({ data: "transcrição de teste" })).rejects.toThrow(
			"unauthenticated",
		);
		await expect(
			novaApi.reviewAnamnese({ data: { transcript: "t", anamnesis: ANAMNESIS } } as never),
		).rejects.toThrow("unauthenticated");
		await expect(
			novaApi.attachAnamnesis({
				data: { consultationId: 1, anamnesis: ANAMNESIS, engine: "e" },
			} as never),
		).resolves.toEqual({ ok: false });
		await expect(
			novaApi.saveConsultation({
				data: { transcript: "t", anamnesis: ANAMNESIS, engine: "e" },
			} as never),
		).rejects.toThrow("unauthenticated");
		await expect(novaApi.recordConsent({ data: 1 })).resolves.toEqual({ ok: false });
		await expect(novaApi.createPatient({ data: "Ana" })).rejects.toThrow("unauthenticated");
	});
});
