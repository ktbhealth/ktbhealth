// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Anamnesis } from "@ktb/anamnesis-llm";
import type { AnamnesisReview, TranscriptEvent } from "@ktb/anamnesis";
import type { NovaApi } from "./NovaConsultaPage.tsx";

// ---------- controllable transcriber mocks ----------
let micSupported = true;
let micCb: ((ev: TranscriptEvent) => void) | null = null;
let tabCb: ((ev: TranscriptEvent) => void) | null = null;
const micStop = vi.fn();
const tabStop = vi.fn();
const engineSubs = new Set<(m: Record<string, unknown>) => void>();

vi.mock("@ktb/transcription-whisper", () => ({
	createWhisperMicTranscriber: () => ({
		get supported() {
			return micSupported;
		},
		start: (cb: (ev: TranscriptEvent) => void) => {
			micCb = cb;
		},
		stop: micStop,
	}),
	createWhisperTabTranscriber: () => ({
		supported: true,
		start: (cb: (ev: TranscriptEvent) => void) => {
			tabCb = cb;
		},
		stop: tabStop,
	}),
	loadWhisper: vi.fn(),
	subscribeWhisper: (fn: (m: Record<string, unknown>) => void) => {
		engineSubs.add(fn);
		return () => engineSubs.delete(fn);
	},
	whisperStatus: () => ({ state: "idle", device: null }),
}));

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: (props: Record<string, unknown>) =>
			React.createElement("a", { href: String(props.to ?? "#"), ...props }, props.children as never),
	};
});

import { NovaConsultaPage } from "./NovaConsultaPage.tsx";

const SECTION = { content: "", confidence: "baixa" as const, evidence: [] as string[] };
const ANAMNESIS: Anamnesis = {
	queixa_principal: { content: "Dor de cabeça", confidence: "alta", evidence: ["dor de cabeça"] },
	hda: SECTION,
	antecedentes: SECTION,
	alergias: SECTION,
	medicamentos_em_uso: SECTION,
	exame_fisico: SECTION,
	hipoteses: SECTION,
	conduta: SECTION,
};

const REVIEW: AnamnesisReview = {
	lacunas: [{ secao: "hda", o_que_falta: "falta x", pergunta_sugerida: "quando?", motivo: "m" }],
	hipoteses: [
		{ diagnostico: "Enxaqueca", probabilidade: "alta", raciocinio: "r", evidence: ["e"], investigar: ["i"] },
	],
	sinais_de_alerta: [],
	inconsistencias: [],
};

function makeApi(overrides: Partial<NovaApi> = {}): NovaApi {
	return {
		getLiveConsultation: vi.fn(async () => null),
		extractAnamnese: vi.fn(async () => ({ anamnesis: ANAMNESIS, engine: "heuristic" })),
		reviewAnamnese: vi.fn(async () => ({ review: REVIEW, engine: "anthropic:x" })),
		attachAnamnesis: vi.fn(async () => ({ ok: true })),
		saveConsultation: vi.fn(async () => ({ id: 42 })),
		recordConsent: vi.fn(async () => ({ ok: true })),
		createPatient: vi.fn(async () => ({ id: 7, name: "Ana" })),
		...overrides,
	} as NovaApi;
}

const PATIENTS = [
	{ id: 1, name: "Maria" },
	{ id: 2, name: "João" },
];

function renderPage(api = makeApi(), patients = PATIENTS) {
	return render(<NovaConsultaPage initialPatients={patients} api={api} />);
}

async function consent(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByText(/Declaro que o paciente/));
}

async function fillTranscript(text = "paciente relata dor") {
	fireEvent.change(screen.getByLabelText("Texto da consulta"), { target: { value: text } });
}

async function generateAnamnesis(user: ReturnType<typeof userEvent.setup>) {
	await fillTranscript();
	await user.click(screen.getByText("Gerar anamnese →"));
	await screen.findByText("confiança alta");
}

describe("NovaConsultaPage", () => {
	beforeEach(() => {
		micSupported = true;
		micCb = null;
		tabCb = null;
		engineSubs.clear();
		vi.stubGlobal("fetch", vi.fn());
		// jsdom lacks dialog.showModal
		HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
			this.setAttribute("open", "");
		});
		HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
			this.removeAttribute("open");
		});
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renders empty state and steps", () => {
		renderPage();
		expect(screen.getByText("Nova consulta")).toBeTruthy();
		expect(screen.getByText(/A anamnese estruturada aparece aqui/)).toBeTruthy();
		expect(screen.getByText("Preparar")).toBeTruthy();
		expect(screen.getByText("Transcrever")).toBeTruthy();
		expect(screen.getByText("Revisar")).toBeTruthy();
	});

	it("creates a new patient", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await user.type(screen.getByLabelText("Nome do novo paciente"), "Ana");
		await user.click(screen.getByText("+ paciente"));
		await waitFor(() => expect(api.createPatient).toHaveBeenCalledWith({ data: "Ana" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Paciente") as HTMLSelectElement).value).toBe("7"),
		);
	});

	it("ignores empty patient name", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await user.click(screen.getByText("+ paciente"));
		expect(api.createPatient).not.toHaveBeenCalled();
	});

	it("handles createPatient returning null", async () => {
		const user = userEvent.setup();
		const api = makeApi({ createPatient: vi.fn(async () => null) });
		renderPage(api);
		await user.type(screen.getByLabelText("Nome do novo paciente"), "X");
		await user.click(screen.getByText("+ paciente"));
		await waitFor(() => expect(api.createPatient).toHaveBeenCalled());
	});

	it("selects an existing patient and toggles consent", async () => {
		const user = userEvent.setup();
		renderPage();
		fireEvent.change(screen.getByLabelText("Paciente"), { target: { value: "2" } });
		expect((screen.getByLabelText("Paciente") as HTMLSelectElement).value).toBe("2");
		await consent(user);
		const cb = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(cb.checked).toBe(true);
		await user.click(screen.getByText(/Declaro que o paciente/));
		expect(cb.checked).toBe(false);
	});

	it("switches source tabs", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByText("Upload"));
		expect(screen.getByText("Enviar gravação")).toBeTruthy();
		await user.click(screen.getByText("Teleconsulta (bot)"));
		expect(screen.getByLabelText("Link da teleconsulta")).toBeTruthy();
		await user.click(screen.getByText("Gravar"));
		expect(screen.getByText("Gravar microfone")).toBeTruthy();
	});

	it("shows consent warning and disables recording until consent", async () => {
		const user = userEvent.setup();
		renderPage();
		expect(screen.getByText(/Marque o consentimento acima/)).toBeTruthy();
		const btn = screen.getByText("Gravar microfone").closest("button")!;
		expect(btn.disabled).toBe(true);
		await consent(user);
		expect(btn.disabled).toBe(false);
	});

	it("shows unsupported message when whisper unsupported", () => {
		micSupported = false;
		renderPage();
		expect(screen.getByText(/Gravação não suportada/)).toBeTruthy();
	});

	it("mic recording lifecycle: start, partial, final, stop", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Gravar microfone"));
		expect(micCb).not.toBeNull();
		expect(screen.getByText("Parar microfone")).toBeTruthy();
		expect(screen.getByText(/gravando… fale normalmente/)).toBeTruthy();

		act(() => micCb!({ type: "partial", text: "acha que" }));
		await screen.findByText(/acha que…/);
		act(() => micCb!({ type: "final", text: "tem febre" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Texto da consulta") as HTMLTextAreaElement).value).toContain(
				"Médico: tem febre",
			),
		);

		await user.click(screen.getByText("Parar microfone"));
		expect(micStop).toHaveBeenCalled();
		expect(screen.getByText("Gravar microfone")).toBeTruthy();
	});

	it("mic error event sets error and stops recording", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Gravar microfone"));
		act(() => micCb!({ type: "error", message: "mic denied" }));
		await screen.findByText("mic denied");
		expect(screen.getByText("Gravar microfone")).toBeTruthy();
	});

	it("mic end event stops recording", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Gravar microfone"));
		act(() => micCb!({ type: "end" }));
		expect(screen.getByText("Gravar microfone")).toBeTruthy();
	});

	it("tab capture lifecycle appends Paciente lines", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capturar aba da chamada"));
		expect(tabCb).not.toBeNull();
		act(() => tabCb!({ type: "final", text: "oi doutor" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Texto da consulta") as HTMLTextAreaElement).value).toContain(
				"Paciente: oi doutor",
			),
		);
		await user.click(screen.getByText("Parar aba"));
		expect(tabStop).toHaveBeenCalled();
	});

	it("tab error event sets error", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capturar aba da chamada"));
		act(() => tabCb!({ type: "error", message: "no tab" }));
		await screen.findByText("no tab");
		expect(screen.getByText("Capturar aba da chamada")).toBeTruthy();
	});

	it("tab end event stops capture", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capturar aba da chamada"));
		act(() => tabCb!({ type: "end" }));
		expect(screen.getByText("Capturar aba da chamada")).toBeTruthy();
	});

	it("uploads audio file and appends transcript", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ text: "transcrito" }),
			})),
		);
		renderPage();
		await user.click(screen.getByText("Upload"));
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		const file = new File(["audio"], "a.webm", { type: "audio/webm" });
		fireEvent.change(input, { target: { files: [file] } });
		await waitFor(() =>
			expect((screen.getByLabelText("Texto da consulta") as HTMLTextAreaElement).value).toBe(
				"transcrito",
			),
		);
	});

	it("upload appends to existing transcript and handles errors", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 500 })),
		);
		renderPage();
		await fillTranscript("existente");
		await user.click(screen.getByText("Upload"));
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [new File(["x"], "a.mp3")] } });
		await screen.findByText(/transcrição falhou \(500\)/);
	});

	it("upload with no file does nothing", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByText("Upload"));
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [] } });
	});

	it("sends bot and polls live consultation", async () => {
		const user = userEvent.setup();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const api = makeApi({
			getLiveConsultation: vi
				.fn()
				.mockResolvedValueOnce({ transcript: "Médico: oi", status: "live" })
				.mockResolvedValue({ transcript: "Médico: oi\nPaciente: olá", status: "done" }),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ consultationId: 9, provider: "stub" }),
			})),
		);
		renderPage(api);
		await user.click(screen.getByText("Teleconsulta (bot)"));
		await user.type(screen.getByLabelText("Link da teleconsulta"), "https://meet.google.com/abc");
		await user.click(screen.getByText("Enviar bot"));
		await screen.findByText(/consulta #9/);
		await vi.advanceTimersByTimeAsync(1600);
		await vi.advanceTimersByTimeAsync(1600);
		vi.useRealTimers();
		expect(api.getLiveConsultation).toHaveBeenCalled();
	});

	it("sendBot guards empty url and handles failure", async () => {
		const user = userEvent.setup();
		const fetchMock = vi.fn(async () => ({
			ok: false,
			status: 400,
			json: async () => ({ error: "bad url" }),
		}));
		vi.stubGlobal("fetch", fetchMock);
		renderPage();
		await user.click(screen.getByText("Teleconsulta (bot)"));
		const btn = screen.getByText("Enviar bot").closest("button")!;
		expect(btn.disabled).toBe(true);
		await user.type(screen.getByLabelText("Link da teleconsulta"), "http://x");
		await user.click(screen.getByText("Enviar bot"));
		await screen.findByText("bad url");
	});

	it("sendBot handles missing consultationId in response", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
		);
		renderPage();
		await user.click(screen.getByText("Teleconsulta (bot)"));
		await user.type(screen.getByLabelText("Link da teleconsulta"), "http://x");
		await user.click(screen.getByText("Enviar bot"));
		await screen.findByText(/bot falhou: HTTP 200/);
	});

	it("generates anamnesis and runs review", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await generateAnamnesis(user);
		expect(api.extractAnamnese).toHaveBeenCalled();
		expect(api.reviewAnamnese).toHaveBeenCalled();
		// switch to review tab
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("Enxaqueca");
		expect(screen.getByText(/Apoio à decisão/)).toBeTruthy();
	});

	it("generate guards empty transcript and surfaces errors", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			extractAnamnese: vi.fn(async () => {
				throw new Error("llm down");
			}),
		});
		renderPage(api);
		const btn = screen.getByText("Gerar anamnese →").closest("button")!;
		expect(btn.disabled).toBe(true);
		await fillTranscript("algo");
		await user.click(screen.getByText("Gerar anamnese →"));
		await screen.findByText("llm down");
	});

	it("review failure sets reviewNote", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			reviewAnamnese: vi.fn(async () => ({ review: null, reason: "sem modelo" })),
		});
		renderPage(api);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("sem modelo");
	});

	it("review exception sets reviewNote", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			reviewAnamnese: vi.fn(async () => {
				throw new Error("review exploded");
			}),
		});
		renderPage(api);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("review exploded");
	});

	it("edits a section textarea", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		const ta = document.getElementById("sec-queixa_principal") as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: "editado" } });
		expect(ta.value).toBe("editado");
	});

	it("shows evidence details when present", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		expect(screen.getByText(/evidência \(1\)/)).toBeTruthy();
	});

	it("copies anamnesis to clipboard", async () => {
		const user = userEvent.setup();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Copiar"));
		await waitFor(() => expect(writeText).toHaveBeenCalled());
		await screen.findByText(/Anamnese copiada/);
	});

	it("copy failure sets error", async () => {
		const user = userEvent.setup();
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
			configurable: true,
		});
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Copiar"));
		await screen.findByText(/Não foi possível copiar/);
	});

	it("saves a new consultation with consent", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await consent(user);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Salvar consulta"));
		await screen.findByText("Anamnese salva com sucesso");
		expect(api.saveConsultation).toHaveBeenCalled();
		expect(api.recordConsent).toHaveBeenCalledWith({ data: 42 });
		// dialog actions
		expect(screen.getByText("⬇ Baixar PDF")).toBeTruthy();
		expect(screen.getByText("Ver consulta")).toBeTruthy();
		await user.click(screen.getByText("Confirmar"));
		// now shows update label
		await user.click(screen.getByText("Atualizar consulta"));
		await screen.findByText("Consulta atualizada");
		expect(api.attachAnamnesis).toHaveBeenCalled();
	});

	it("save without consent skips recordConsent", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api, []);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Salvar consulta"));
		await screen.findByText("Anamnese salva com sucesso");
		expect(api.recordConsent).not.toHaveBeenCalled();
	});

	it("save error paths: attach fails, save fails, exception", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			attachAnamnesis: vi.fn(async () => ({ ok: false })),
			saveConsultation: vi.fn(async () => {
				throw new Error("db gone");
			}),
		});
		renderPage(api);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Salvar consulta"));
		await screen.findByText("db gone");
		await user.click(screen.getByText("Entendi"));
	});

	it("save with liveId uses attachAnamnesis path", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			attachAnamnesis: vi.fn(async () => ({ ok: true })),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ consultationId: 5, provider: "stub" }),
			})),
		);
		renderPage(api);
		await user.click(screen.getByText("Teleconsulta (bot)"));
		await user.type(screen.getByLabelText("Link da teleconsulta"), "http://x");
		await user.click(screen.getByText("Enviar bot"));
		await screen.findByText(/consulta #5/);
		await fillTranscript("transcrição da call");
		await user.click(screen.getByText("Gerar anamnese →"));
		await screen.findByText("confiança alta");
		await user.click(screen.getByText("Salvar consulta"));
		await screen.findByText("Consulta atualizada");
		expect(api.attachAnamnesis).toHaveBeenCalled();
		expect(api.saveConsultation).not.toHaveBeenCalled();
	});

	it("save dialog without review omits segunda opiniao text", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			reviewAnamnese: vi.fn(async () => ({ review: null, reason: "offline" })),
		});
		renderPage(api);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Salvar consulta"));
		const dialog = await screen.findByText("Anamnese salva com sucesso");
		expect(dialog.textContent).not.toContain("segunda opinião");
		expect(dialog.textContent).not.toContain("Consentimento");
	});

	it("saveDialog error variant for non-Error throw", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			saveConsultation: vi.fn(async () => {
				throw "string error";
			}),
		});
		renderPage(api);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Salvar consulta"));
		await screen.findByText("Não foi possível salvar");
		expect(screen.getByText("string error")).toBeTruthy();
	});

	it("addHypothesis via review panel", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("Enxaqueca");
		// hipoteses section starts empty placeholder
		await user.click(screen.getAllByText("+ adicionar às hipóteses")[0]!);
		await screen.findByText("Hipótese adicionada à anamnese");
		// switch back and check content
		await user.click(screen.getByText("Anamnese"));
		const ta = document.getElementById("sec-hipoteses") as HTMLTextAreaElement;
		expect(ta.value).toContain("Enxaqueca — r");
	});

	it("addHypothesis returns false when already present", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			extractAnamnese: vi.fn(async () => ({
				anamnesis: {
					...ANAMNESIS,
					hipoteses: { content: "- Enxaqueca — r", confidence: "baixa" as const, evidence: [] },
				},
				engine: "heuristic",
			})),
		});
		renderPage(api);
		await fillTranscript("x");
		await user.click(screen.getByText("Gerar anamnese →"));
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("Enxaqueca");
		await user.click(screen.getAllByText("+ adicionar às hipóteses")[0]!);
		await screen.findByText("Essa hipótese já está na anamnese");
	});

	it("toast action switches tab and scrolls to section", async () => {
		const user = userEvent.setup();
		const scrollIntoView = vi.fn();
		const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
		Element.prototype.scrollIntoView = scrollIntoView;
		renderPage();
		await fillTranscript("x");
		await user.click(screen.getByText("Gerar anamnese →"));
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("Enxaqueca");
		await user.click(screen.getAllByText("+ adicionar às hipóteses")[0]!);
		const ver = await screen.findByText("Ver");
		await user.click(ver);
		expect(screen.getByText("Anamnese")).toBeTruthy();
		await waitFor(() => expect(scrollIntoView).toHaveBeenCalled(), { timeout: 500 });
		await waitFor(() => expect(focusSpy).toHaveBeenCalled(), { timeout: 500 });
	});

	it("dialog closes via backdrop click", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Salvar consulta"));
		await screen.findByText("Anamnese salva com sucesso");
		const dialog = document.querySelector("dialog") as HTMLDialogElement;
		expect(dialog.open).toBe(true);
		// click directly on the dialog element = backdrop
		fireEvent.click(dialog);
		await waitFor(() => expect(dialog.open).toBe(false));
	});

	it("sample transcript and clear buttons", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByText("Usar exemplo"));
		const ta = screen.getByLabelText("Texto da consulta") as HTMLTextAreaElement;
		expect(ta.value.length).toBeGreaterThan(50);
		await user.click(screen.getByText("Limpar"));
		expect(ta.value).toBe("");
	});

	it("textarea onChange updates transcript", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.type(screen.getByLabelText("Texto da consulta"), "digitado");
		expect((screen.getByLabelText("Texto da consulta") as HTMLTextAreaElement).value).toBe(
			"digitado",
		);
	});

	it("engine and reviewEngine labels render", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			reviewAnamnese: vi.fn(async () => ({ review: REVIEW, engine: "openai:gpt" })),
		});
		renderPage(api);
		await generateAnamnesis(user);
		expect(screen.getByText("engine: heuristic")).toBeTruthy();
		await user.click(screen.getByText("Segunda opinião"));
		await screen.findByText("openai:gpt");
	});

	it("review badge shows count", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
	});

	it("model status updates from engine messages", async () => {
		renderPage();
		for (const fn of engineSubs) fn({ type: "progress", message: "baixando 50%" });
		await screen.findByText(/🧠 baixando 50%/);
		for (const fn of engineSubs) fn({ type: "ready", device: "webgpu" });
		await screen.findByText(/modelo pronto — webgpu/);
		for (const fn of engineSubs) fn({ type: "error", message: "falhou tudo" });
		await screen.findByText(/modelo indisponível: falhou tudo/);
	});

	it("live consultation done stops polling and shows call encerrada", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			getLiveConsultation: vi.fn(async () => ({ transcript: "t", status: "done" })),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ consultationId: 3, provider: "stub" }),
			})),
		);
		renderPage(api);
		await user.click(screen.getByText("Teleconsulta (bot)"));
		await user.type(screen.getByLabelText("Link da teleconsulta"), "http://x");
		await user.click(screen.getByText("Enviar bot"));
		await screen.findByText(/call encerrada/, {}, { timeout: 4000 });
	});
});
