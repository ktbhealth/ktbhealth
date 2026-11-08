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
import type { ConsultationDetail } from "./ConsultationDetailPage.tsx";
import { ConsultationDetailPage } from "./ConsultationDetailPage.tsx";

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

const BASE: ConsultationDetail = {
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
};

const detail = (over: Partial<ConsultationDetail>): ConsultationDetail => ({ ...BASE, ...over });

afterEach(cleanup);

describe("ConsultationDetailPage", () => {
	it("renders full detail with anamnesis and transcript", () => {
		render(<ConsultationDetailPage c={detail({})} />);
		expect(screen.getByText("Maria")).toBeTruthy();
		expect(screen.getByText(/Consultation #10/)).toBeTruthy();
		expect(screen.getByText(/engine: heuristic/)).toBeTruthy();
		expect(screen.getByText(/Consent ✓/)).toBeTruthy();
		expect(screen.getByText("Browser voice")).toBeTruthy();
		expect(screen.getByText("Dor")).toBeTruthy();
		expect(screen.getByText(/evidence \(1\)/)).toBeTruthy();
		expect(screen.getByText("olá doutor")).toBeTruthy();
		expect(screen.queryByText("Segunda opinião")).toBeNull();
	});

	it("renders minimal detail: no anamnesis/patient/consent", () => {
		render(
			<ConsultationDetailPage
				c={detail({
					patientName: null,
					anamnesis: null,
					consentAt: null,
					engine: null,
					source: null,
					status: "live",
				})}
			/>,
		);
		expect(screen.getByText("Consultation #10")).toBeTruthy();
		expect(screen.getByText("Consent not recorded")).toBeTruthy();
		expect(screen.getByText("in progress")).toBeTruthy();
		expect(screen.getByText(/does not have a saved anamnesis/)).toBeTruthy();
		expect(screen.getByText("olá doutor")).toBeTruthy();
	});

	it("shows empty transcript message", () => {
		render(<ConsultationDetailPage c={detail({ transcript: "  \n " })} />);
		expect(screen.getByText("No transcript.")).toBeTruthy();
	});

	it("copies anamnesis to clipboard", async () => {
		const user = userEvent.setup();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		render(<ConsultationDetailPage c={detail({})} />);
		await user.click(screen.getByText("Copy"));
		await waitFor(() => expect(writeText).toHaveBeenCalled());
		await screen.findByText("Anamnesis copied");
		await user.click(screen.getByLabelText("Dismiss notification"));
		await waitFor(() => expect(screen.queryByText("Anamnesis copied")).toBeNull());
	});

	it("copy without anamnesis is a no-op (button hidden)", () => {
		render(<ConsultationDetailPage c={detail({ anamnesis: null })} />);
		expect(screen.queryByText("Copy")).toBeNull();
		expect(screen.queryByText("Download PDF")).toBeNull();
	});

	it("renders pending section styling and dash for empty content", () => {
		render(<ConsultationDetailPage c={detail({})} />);
		expect(screen.getByText(/A preencher pelo médico/)).toBeTruthy();
	});

	it("tolerates anamnesis missing section keys", () => {
		const partial = { queixa_principal: SECTION } as unknown as Anamnesis;
		render(<ConsultationDetailPage c={detail({ anamnesis: partial })} />);
		expect(screen.getByText("Chief complaint")).toBeTruthy();
	});

	it("renders transcript lines without speaker prefix and unknown speakers", () => {
		render(
			<ConsultationDetailPage
				c={detail({
					transcript: "linha solta\nEnfermeiro Chefe: preparado?\nMédico: sim",
				})}
			/>,
		);
		expect(screen.getByText("linha solta")).toBeTruthy();
		expect(screen.getByText("Enfermeiro Chefe")).toBeTruthy();
		expect(screen.getByText("Médico")).toBeTruthy();
	});
});
