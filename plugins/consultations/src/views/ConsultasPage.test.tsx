// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

import { ConsultasPage, type ConsultaListItem } from "./ConsultasPage.tsx";

const BASE: ConsultaListItem = {
	id: 1,
	engine: "heuristic",
	createdAt: new Date("2026-11-06T14:30:00"),
	transcript: "Médico: oi\nPaciente: olá",
	source: "browser",
	status: "done",
	consentAt: new Date("2026-11-06T14:00:00"),
	patientName: "Maria Silva",
	queixa: "Dor de cabeça",
	hasAnamnesis: true,
};

const item = (over: Partial<ConsultaListItem>): ConsultaListItem => ({ ...BASE, ...over });

afterEach(cleanup);

describe("ConsultasPage", () => {
	it("renders empty state", () => {
		render(<ConsultasPage consultas={[]} />);
		expect(screen.getByText("Nenhuma consulta ainda.")).toBeTruthy();
		expect(screen.getByText("Nenhuma consulta ainda")).toBeTruthy();
		expect(screen.getByText("Iniciar consulta")).toBeTruthy();
	});

	it("renders singular/plural count and list", () => {
		render(<ConsultasPage consultas={[item({})]} />);
		expect(screen.getByText("1 consulta registrada.")).toBeTruthy();
		expect(screen.getByText("Maria Silva")).toBeTruthy();
		expect(screen.getByText("Dor de cabeça")).toBeTruthy();
	});

	it("renders badges for live/anamnesis/consent/source", () => {
		render(
			<ConsultasPage
				consultas={[
					item({
						status: "live",
						source: "bot",
						patientName: null,
						hasAnamnesis: false,
						consentAt: null,
					}),
				]}
			/>,
		);
		expect(screen.getByText("● ao vivo")).toBeTruthy();
		expect(screen.getByText("Sem anamnese")).toBeTruthy();
		expect(screen.getByText("Teleconsulta (bot)")).toBeTruthy();
		expect(screen.getByText("Paciente não vinculado")).toBeTruthy();
		expect(screen.getByText("Dor de cabeça")).toBeTruthy();
	});

	it("falls back to transcript when queixa is placeholder", () => {
		render(
			<ConsultasPage
				consultas={[item({ queixa: "A preencher pelo médico", transcript: "fallback text" })]}
			/>,
		);
		expect(screen.getByText("fallback text")).toBeTruthy();
	});

	it("shows 'Sem transcrição' when no queixa and empty transcript", () => {
		render(<ConsultasPage consultas={[item({ queixa: null, transcript: "" })]} />);
		expect(screen.getByText("Sem transcrição.")).toBeTruthy();
	});

	it("shows PDF link only with anamnesis", () => {
		const { rerender } = render(<ConsultasPage consultas={[item({ hasAnamnesis: true })]} />);
		expect(screen.getByText("PDF")).toBeTruthy();
		rerender(<ConsultasPage consultas={[item({ hasAnamnesis: false })]} />);
		expect(screen.queryByText("PDF")).toBeNull();
	});

	it("filters by search text across fields", async () => {
		const user = userEvent.setup();
		render(
			<ConsultasPage
				consultas={[
					item({ id: 1, patientName: "Ana" }),
					item({ id: 2, patientName: "Bia", queixa: "Tosse seca" }),
				]}
			/>,
		);
		const input = screen.getByLabelText("Buscar consultas");
		await user.type(input, "tosse");
		expect(screen.queryByText("Ana")).toBeNull();
		expect(screen.getByText("Bia")).toBeTruthy();
		await user.clear(input);
		await user.type(input, "zzz-nada");
		expect(screen.getByText(/Nenhuma consulta corresponde/)).toBeTruthy();
	});

	it("filters by anamnese/pendente tabs", async () => {
		const user = userEvent.setup();
		render(
			<ConsultasPage
				consultas={[
					item({ id: 1, patientName: "Ana", hasAnamnesis: true }),
					item({ id: 2, patientName: "Bia", hasAnamnesis: false }),
				]}
			/>,
		);
		await user.click(screen.getByText("Com anamnese"));
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.queryByText("Bia")).toBeNull();
		await user.click(screen.getByText("Pendentes"));
		expect(screen.getByText("Bia")).toBeTruthy();
		expect(screen.queryByText("Ana")).toBeNull();
		await user.click(screen.getByText("Todas"));
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Bia")).toBeTruthy();
	});

	it("handles initials edge cases", () => {
		render(
			<ConsultasPage
				consultas={[
					item({ id: 1, patientName: "  " }),
					item({ id: 2, patientName: "Single" }),
					item({ id: 3, patientName: "Um Dois Três" }),
				]}
			/>,
		);
	});

	it("falls back to raw source label for unknown sources", () => {
		render(
			<ConsultasPage
				consultas={[
					item({ id: 1, source: "custom-source" }),
					item({ id: 2, source: null, patientName: "Bia" }),
				]}
			/>,
		);
		expect(screen.getByText("custom-source")).toBeTruthy();
	});

	it("hides search when list is empty", () => {
		render(<ConsultasPage consultas={[]} />);
		expect(screen.queryByLabelText("Buscar consultas")).toBeNull();
	});
});
