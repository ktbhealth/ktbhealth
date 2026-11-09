// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
	audioKey: null,
	audioStatus: "none",
	audioError: null,
	serverTranscript: null,
	correctedTranscript: null,
	enhancementEngine: null,
};

const detail = (over: Partial<ConsultationDetail>): ConsultationDetail => ({ ...BASE, ...over });

afterEach(cleanup);

describe("ConsultationDetailPage", () => {
	it("renders full detail with anamnesis and transcript", () => {
		render(<ConsultationDetailPage c={detail({})} history={null} />);
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

	it("links the patient name to the patient record", () => {
		render(<ConsultationDetailPage c={detail({})} history={null} />);
		const link = screen.getByTitle("Open patient record");
		expect(link.textContent).toBe("Maria");
		expect(link.getAttribute("href")).toBe("/patients/$id");
	});

	it("shows an unlinked patient name as plain text", () => {
		render(<ConsultationDetailPage c={detail({ patientId: null })} history={null} />);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Maria");
		expect(screen.queryByTitle("Open patient record")).toBeNull();
	});

	it("renders minimal detail: no anamnesis/patient/consent", () => {
		render(
			<ConsultationDetailPage
				history={null}
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
		render(<ConsultationDetailPage c={detail({ transcript: "  \n " })} history={null} />);
		expect(screen.getByText("No transcript.")).toBeTruthy();
	});

	it("copies anamnesis to clipboard", async () => {
		const user = userEvent.setup();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		render(<ConsultationDetailPage c={detail({})} history={null} />);
		await user.click(screen.getByText("Copy"));
		await waitFor(() => expect(writeText).toHaveBeenCalled());
		await screen.findByText("Anamnesis copied");
		await user.click(screen.getByLabelText("Dismiss notification"));
		await waitFor(() => expect(screen.queryByText("Anamnesis copied")).toBeNull());
	});

	it("copy without anamnesis is a no-op (button hidden)", () => {
		render(<ConsultationDetailPage c={detail({ anamnesis: null })} history={null} />);
		expect(screen.queryByText("Copy")).toBeNull();
		expect(screen.queryByText("Download PDF")).toBeNull();
	});

	it("renders pending section styling and dash for empty content", () => {
		render(<ConsultationDetailPage c={detail({})} history={null} />);
		expect(screen.getByText(/A preencher pelo médico/)).toBeTruthy();
	});

	it("tolerates anamnesis missing section keys", () => {
		const partial = { queixa_principal: SECTION } as unknown as Anamnesis;
		render(<ConsultationDetailPage c={detail({ anamnesis: partial })} history={null} />);
		expect(screen.getByText("Chief complaint")).toBeTruthy();
	});

	it("shows previous-consultations badge and collapsed history", () => {
		render(
			<ConsultationDetailPage
				c={detail({})}
				history={{
					count: 2,
					visits: [
						{
							id: 8,
							date: "2026-03-05T14:30:00.000Z",
							chiefComplaint: "Dor de cabeça",
							plan: "Dipirona",
						},
						{ id: 7, date: "2026-01-20T10:00:00.000Z", chiefComplaint: null, plan: null },
					],
				}}
			/>,
		);
		expect(screen.getByText("2 previous consultations")).toBeTruthy();
		expect(screen.getByText(/Prior consultations · 2 previous consultations/)).toBeTruthy();
		expect(screen.getByText("Complaint: Dor de cabeça")).toBeTruthy();
		expect(screen.getByText("Plan: Dipirona")).toBeTruthy();
		expect(screen.getByText(/consultation #8/)).toBeTruthy();
		expect(screen.getByText(/not clinical suggestions/)).toBeTruthy();
	});

	it("singularizes the badge for a single previous consultation", () => {
		render(
			<ConsultationDetailPage
				c={detail({})}
				history={{
					count: 1,
					visits: [
						{
							id: 8,
							date: "2026-03-05T14:30:00.000Z",
							chiefComplaint: "Febre",
							plan: null,
						},
					],
				}}
			/>,
		);
		expect(screen.getByText("1 previous consultation")).toBeTruthy();
		expect(screen.getByText("Complaint: Febre")).toBeTruthy();
	});

	it("hides history UI when count is zero", () => {
		render(<ConsultationDetailPage c={detail({})} history={{ count: 0, visits: [] }} />);
		expect(screen.queryByText(/previous consultation/)).toBeNull();
	});

	it("shows corrected/original tabs, status chip and audio player", () => {
		render(
			<ConsultationDetailPage
				c={detail({
					audioKey: "audio/u1/10/x.webm",
					audioStatus: "done",
					serverTranscript: "Médico: oi\nPaciente: olá",
					correctedTranscript: "Médico: Olá.\nPaciente: Olá, doutor.",
				})}
				history={null}
			/>,
		);
		// corrected is the default tab
		expect(screen.getByText("Olá, doutor.")).toBeTruthy();
		expect(screen.getByText("Corrected")).toBeTruthy();
		expect(screen.getByText("Original")).toBeTruthy();
		expect(screen.getByText("enhanced ✓")).toBeTruthy();
		const audio = document.querySelector("audio") as HTMLAudioElement;
		expect(audio.src).toContain("/api/consultations/10/audio");
	});

	it("original tab shows labeled server and browser transcripts", async () => {
		const user = userEvent.setup();
		render(
			<ConsultationDetailPage
				c={detail({
					audioKey: "k",
					audioStatus: "done",
					serverTranscript: "server raw text",
					correctedTranscript: "clean corrected",
				})}
				history={null}
			/>,
		);
		await user.click(screen.getByText("Original"));
		expect(screen.getByText("server raw text")).toBeTruthy();
		expect(screen.getByText("server · whisper large-v3-turbo")).toBeTruthy();
		// browser transcript differs → shown as a second labeled block
		expect(screen.getByText("browser")).toBeTruthy();
		expect(screen.getByText("olá doutor")).toBeTruthy();
		await user.click(screen.getByText("Corrected"));
		expect(screen.getByText("clean corrected")).toBeTruthy();
		expect(screen.getByText("llm corrected")).toBeTruthy();
	});

	it("hides tabs when there is no corrected transcript and shows raw originals", () => {
		render(
			<ConsultationDetailPage
				c={detail({
					audioKey: "k",
					audioStatus: "done",
					serverTranscript: "server raw text",
				})}
				history={null}
			/>,
		);
		expect(screen.queryByText("Corrected")).toBeNull();
		expect(screen.getByText("server raw text")).toBeTruthy();
		expect(screen.getByText("browser")).toBeTruthy();
	});

	it("shows enhancing and failed status chips", () => {
		const { unmount } = render(
			<ConsultationDetailPage
				c={detail({ audioKey: "k", audioStatus: "processing" })}
				history={null}
			/>,
		);
		expect(screen.getByText(/enhancing transcript/)).toBeTruthy();
		unmount();
		render(
			<ConsultationDetailPage
				c={detail({ audioKey: "k", audioStatus: "failed" })}
				history={null}
			/>,
		);
		expect(screen.getByText(/enhancement failed — showing original/)).toBeTruthy();
	});

	it("polls getConsultation while the pipeline is in flight", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const api = {
			getConsultation: vi
				.fn()
				.mockResolvedValueOnce({
					audioStatus: "processing",
					audioKey: "k",
					serverTranscript: null,
					correctedTranscript: null,
				})
				.mockResolvedValue({
					audioStatus: "done",
					audioKey: "k",
					serverTranscript: "server raw",
					correctedTranscript: "clean corrected",
				}),
		};
		render(
			<ConsultationDetailPage
				c={detail({ audioKey: "k", audioStatus: "queued" })}
				history={null}
				api={api}
			/>,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(api.getConsultation).toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3100);
		});
		await screen.findByText("clean corrected");
		expect(screen.getByText("enhanced ✓")).toBeTruthy();
		vi.useRealTimers();
	});

	it("renders transcript lines without speaker prefix and unknown speakers", () => {
		render(
			<ConsultationDetailPage
				history={null}
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
