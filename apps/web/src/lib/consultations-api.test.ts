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

// platform.ts publishes the server runtime (@ktb/server-fns) that the
// consultations plugin's fns reach through the registry.
import "./platform.ts";
import {
	consultationDetailApi,
	newConsultationApi,
	validateNewConsultationSearch,
} from "@ktb/consultations/apis";

describe("newConsultationApi wiring", () => {
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
		await expect(newConsultationApi.getLiveConsultation({ data: 1 })).resolves.toBeNull();
		await expect(
			newConsultationApi.extractAnamnesis({
				data: { transcript: "transcrição de teste", patientId: 3 },
			}),
		).rejects.toThrow("unauthenticated");
		await expect(
			newConsultationApi.attachAnamnesis({
				data: { consultationId: 1, anamnesis: ANAMNESIS, engine: "e" },
			} as never),
		).resolves.toEqual({ ok: false });
		await expect(
			newConsultationApi.saveConsultation({
				data: { transcript: "t", anamnesis: ANAMNESIS, engine: "e" },
			} as never),
		).rejects.toThrow("unauthenticated");
		await expect(newConsultationApi.recordConsent({ data: 1 })).resolves.toEqual({ ok: false });
		await expect(
			newConsultationApi.createPatient({ data: { name: "Ana", birthDate: "1984" } }),
		).rejects.toThrow("unauthenticated");
		await expect(consultationDetailApi.getConsultation({ data: 1 })).resolves.toBeNull();
	});

	it("accepts only a positive integer patientId search param", () => {
		expect(validateNewConsultationSearch({ patientId: "7" })).toEqual({ patientId: 7 });
		expect(validateNewConsultationSearch({ patientId: 7 })).toEqual({ patientId: 7 });
		expect(validateNewConsultationSearch({})).toEqual({});
		expect(validateNewConsultationSearch({ patientId: "abc" })).toEqual({});
		expect(validateNewConsultationSearch({ patientId: "-1" })).toEqual({});
		expect(validateNewConsultationSearch({ patientId: "1.5" })).toEqual({});
	});
});
