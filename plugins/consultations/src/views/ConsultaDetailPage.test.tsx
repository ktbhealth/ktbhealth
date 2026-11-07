// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: (props: Record<string, unknown>) =>
			React.createElement(
				"a",
				{ href: String(props.to ?? "#"), ...props },
				props.children as never,
			),
	};
});

import type { Anamnesis } from "@ktb/anamnesis";
import type { ConsultaDetail } from "./ConsultaDetailPage.tsx";
import { ConsultaDetailPage } from "./ConsultaDetailPage.tsx";

const SECTION = { content: "", confidence: "baixa" as const, evidence: [] as string[] };
const ANAMNESIS = {
	queixa_principal: { content: "Dor", confidence: "alta" as const, evidence: ["dor relatada"] },
	hda: { content: "A preencher pelo médico: hda.", confidence: "media" as const, evidence: [] },
	antecedentes: SECTION,
	alergias: SECTION,
	medicamentos_em_uso: SECTION,
	exame_fisico: SECTION,
	hipoteses: SECTION,
	conduta: { content: "", confidence: "baixa" as const, evidence: [] },
};

const REVIEW = {
	lacunas: [],
	hipoteses: [
		{
			diagnostico: "Enxaqueca",
			probabilidade: "alta" as const,
			raciocinio: "r",
			evidence: [],
			investigar: [],
		},
	],
	sinais_de_alerta: ["alerta x"],
	inconsistencias: [],
};

const BASE: ConsultaDetail = {
	id: 10,
	userId: "u1",
	patientId: 1,
	botId: null,
	createdAt: new Date("2026-11-06T14:30:00"),
	transcript: "Médico: oi\nPaciente: olá doutor",
	source: "browser",
	status: "done",
	engine: "heuristic",
	consentAt: new Date("2026-11-06T14:00:00"),
	patientName: "Maria",
	anamnesis: ANAMNESIS,
	review: REVIEW,
};

const detail = (over: Partial<ConsultaDetail>): ConsultaDetail => ({ ...BASE, ...over });

afterEach(cleanup);

describe("ConsultaDetailPage", () => {
	it("renders full detail with anamnesis and review", () => {
		render(<ConsultaDetailPage c={detail({})} />);
		expect(screen.getByText("Maria")).toBeTruthy();
		expect(screen.getByText(/Consulta #10/)).toBeTruthy();
		expect(screen.getByText(/engine: heuristic/)).toBeTruthy();
		expect(screen.getByText(/Consentimento ✓/)).toBeTruthy();
		expect(screen.getByText("Voz no navegador")).toBeTruthy();
		expect(screen.getByText("Dor")).toBeTruthy();
		expect(screen.getByText(/evidência \(1\)/)).toBeTruthy();
		// review tab is default when review exists
		expect(screen.getByText(/Apoio à decisão gerado por IA/)).toBeTruthy();
		expect(screen.getByText("alerta x")).toBeTruthy();
	});

	it("renders minimal detail: no anamnesis/review/patient/consent", () => {
		render(
			<ConsultaDetailPage
				c={detail({
					patientName: null,
					anamnesis: null,
					review: null,
					consentAt: null,
					engine: null,
					source: null,
					status: "live",
				})}
			/>,
		);
		expect(screen.getByText("Consulta #10")).toBeTruthy();
		expect(screen.getByText("Consentimento não registrado")).toBeTruthy();
		expect(screen.getByText("em andamento")).toBeTruthy();
		expect(screen.getByText(/ainda não tem anamnese/)).toBeTruthy();
		expect(screen.getByText("olá doutor")).toBeTruthy();
		expect(screen.queryByText("Segunda opinião")).toBeNull();
	});

	it("switches between review and transcript tabs", async () => {
		const user = userEvent.setup();
		render(<ConsultaDetailPage c={detail({})} />);
		await user.click(screen.getByText("Transcrição"));
		expect(screen.getByText("olá doutor")).toBeTruthy();
		await user.click(screen.getByText("Segunda opinião"));
		expect(screen.getByText("Enxaqueca")).toBeTruthy();
	});

	it("shows empty transcript message", () => {
		render(<ConsultaDetailPage c={detail({ transcript: "  \n ", review: null })} />);
		expect(screen.getByText("Sem transcrição.")).toBeTruthy();
	});

	it("copies anamnesis to clipboard", async () => {
		const user = userEvent.setup();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		render(<ConsultaDetailPage c={detail({})} />);
		await user.click(screen.getByText("Copiar"));
		await waitFor(() => expect(writeText).toHaveBeenCalled());
		await screen.findByText("Anamnese copiada");
		await user.click(screen.getByLabelText("Fechar aviso"));
		await waitFor(() => expect(screen.queryByText("Anamnese copiada")).toBeNull());
	});

	it("copy without anamnesis is a no-op (button hidden)", () => {
		render(<ConsultaDetailPage c={detail({ anamnesis: null })} />);
		expect(screen.queryByText("Copiar")).toBeNull();
		expect(screen.queryByText("⬇ Baixar PDF")).toBeNull();
	});

	it("renders pending section styling and dash for empty content", () => {
		render(<ConsultaDetailPage c={detail({})} />);
		expect(screen.getByText(/A preencher pelo médico/)).toBeTruthy();
	});

	it("tolerates anamnesis missing section keys", () => {
		const partial = { queixa_principal: SECTION } as unknown as Anamnesis;
		render(<ConsultaDetailPage c={detail({ anamnesis: partial })} />);
		expect(screen.getByText("Queixa principal")).toBeTruthy();
	});

	it("renders transcript lines without speaker prefix and unknown speakers", async () => {
		const user = userEvent.setup();
		render(
			<ConsultaDetailPage
				c={detail({
					transcript: "linha solta\nEnfermeiro Chefe: preparado?\nMédico: sim",
				})}
			/>,
		);
		await user.click(screen.getByText("Transcrição"));
		expect(await screen.findByText("linha solta")).toBeTruthy();
		expect(screen.getByText("Enfermeiro Chefe")).toBeTruthy();
		expect(screen.getByText("Médico")).toBeTruthy();
	});
});
