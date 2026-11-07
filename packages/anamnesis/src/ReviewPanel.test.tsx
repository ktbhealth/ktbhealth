// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnamnesisReview } from "./types.ts";
import { ReviewPanel } from "./ReviewPanel.tsx";

const FULL_REVIEW: AnamnesisReview = {
	lacunas: [
		{
			secao: "hda",
			o_que_falta: " duração exata",
			pergunta_sugerida: "Há quanto tempo?",
			motivo: "define cronicidade",
		},
		{ secao: "alergias", o_que_falta: "medicamentos", pergunta_sugerida: "", motivo: "" },
	],
	hipoteses: [
		{
			diagnostico: "Enxaqueca",
			probabilidade: "alta",
			raciocinio: "fotofobia clássica",
			evidence: ["dor frontal", "náusea"],
			investigar: ["exame neurológico"],
		},
		{
			diagnostico: "Sinusite",
			probabilidade: "baixa",
			raciocinio: "",
			evidence: [],
			investigar: [],
		},
	],
	sinais_de_alerta: ["rigidez de nuca"],
	inconsistencias: ["febre negada mas calafrios relatados"],
};

const EMPTY_REVIEW: AnamnesisReview = {
	lacunas: [],
	hipoteses: [],
	sinais_de_alerta: [],
	inconsistencias: [],
};

afterEach(cleanup);

describe("ReviewPanel", () => {
	it("renders empty state when review has nothing", () => {
		render(<ReviewPanel review={EMPTY_REVIEW} />);
		expect(screen.getByText(/não encontrou lacunas/)).toBeTruthy();
	});

	it("renders all sections of a full review", () => {
		render(<ReviewPanel review={FULL_REVIEW} />);
		expect(screen.getByText("Sinais de alerta")).toBeTruthy();
		expect(screen.getByText("rigidez de nuca")).toBeTruthy();
		expect(screen.getByText("Enxaqueca")).toBeTruthy();
		expect(screen.getByText(/prob\. alta/)).toBeTruthy();
		expect(screen.getByText(/fotofobia clássica/)).toBeTruthy();
		expect(screen.getByText(/Investigar: exame neurológico/)).toBeTruthy();
		expect(screen.getByText(/Há quanto tempo\?/)).toBeTruthy();
		expect(screen.getByText(/define cronicidade/)).toBeTruthy();
		expect(screen.getByText(/febre negada/)).toBeTruthy();
	});

	it("adds a hypothesis via onAddHypothesis and marks it", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn(() => true);
		render(<ReviewPanel review={FULL_REVIEW} onAddHypothesis={onAdd} />);
		const buttons = screen.getAllByText("+ adicionar às hipóteses");
		await user.click(buttons[0]!);
		expect(onAdd).toHaveBeenCalledWith("Enxaqueca — fotofobia clássica");
		expect(screen.getAllByText("✓ adicionada")).toHaveLength(1);
		// second click still calls (button remains for other hypotheses)
		await user.click(screen.getAllByText("+ adicionar às hipóteses")[0]!);
	});

	it("does not mark added when callback returns false", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn(() => false);
		render(<ReviewPanel review={FULL_REVIEW} onAddHypothesis={onAdd} />);
		await user.click(screen.getAllByText("+ adicionar às hipóteses")[0]!);
		expect(screen.queryByText("✓ adicionada")).toBeNull();
	});

	it("hides add button without onAddHypothesis", () => {
		render(<ReviewPanel review={FULL_REVIEW} />);
		expect(screen.queryByText("+ adicionar às hipóteses")).toBeNull();
	});

	it("handles undefined callback return as success", async () => {
		const user = userEvent.setup();
		const onAdd = vi.fn(() => undefined);
		render(<ReviewPanel review={FULL_REVIEW} onAddHypothesis={onAdd} />);
		await user.click(screen.getAllByText("+ adicionar às hipóteses")[0]!);
		expect(screen.getAllByText("✓ adicionada")).toHaveLength(1);
	});

	it("renders review without hipoteses section", () => {
		render(
			<ReviewPanel
				review={{
					lacunas: [{ secao: "alergias", o_que_falta: "x", pergunta_sugerida: "", motivo: "" }],
					hipoteses: [],
					sinais_de_alerta: [],
					inconsistencias: [],
				}}
			/>,
		);
		expect(screen.getByText(/Lacunas/)).toBeTruthy();
		expect(screen.queryByText("Hipóteses sugeridas")).toBeNull();
	});

	it("renders lacuna without pergunta/motivo and hipoteses without extras", () => {
		render(<ReviewPanel review={FULL_REVIEW} />);
		// alergias lacuna has empty pergunta_sugerida and motivo
		expect(screen.getByText(/medicamentos/)).toBeTruthy();
		// Sinusite has empty raciocinio/evidence/investigar
		expect(screen.getByText("Sinusite")).toBeTruthy();
	});
});
