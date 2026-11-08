// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Anamnesis } from "@ktb/anamnesis";
import type {
	SessionStats,
	Transcriber,
	TranscriptionBackend,
	TranscriptionEngineMessage,
	TranscriptionStatus,
	TranscriptEvent,
} from "@ktb/transcription";
import type { NewConsultationApi } from "./NewConsultationPage.tsx";

// ---------- controllable transcriber mocks ----------
let micSupported = true;
let micCb: ((ev: TranscriptEvent) => void) | null = null;
let tabCb: ((ev: TranscriptEvent) => void) | null = null;
let statusImpl: () => TranscriptionStatus = () => ({
	state: "idle",
	device: null,
});
const micStop = vi.fn();
const tabStop = vi.fn();
const engineSubs = new Set<(m: TranscriptionEngineMessage) => void>();
// Optional fallback hooks — null means the transcriber lacks the method.
let micStatsFn: (() => SessionStats) | null = null;
let micRecFn: (() => Promise<Blob | null>) | null = null;
let tabStatsFn: (() => SessionStats) | null = null;
let tabRecFn: (() => Promise<Blob | null>) | null = null;

const backend: TranscriptionBackend = {
	mic: (): Transcriber => ({
		get supported() {
			return micSupported;
		},
		start: (cb: (ev: TranscriptEvent) => void) => {
			micCb = cb;
		},
		stop: micStop,
		...(micStatsFn ? { sessionStats: micStatsFn } : {}),
		...(micRecFn ? { recording: micRecFn } : {}),
	}),
	tab: (): Transcriber => ({
		supported: true,
		start: (cb: (ev: TranscriptEvent) => void) => {
			tabCb = cb;
		},
		stop: tabStop,
		...(tabStatsFn ? { sessionStats: tabStatsFn } : {}),
		...(tabRecFn ? { recording: tabRecFn } : {}),
	}),
	status: () => statusImpl(),
	subscribe: (fn: (m: TranscriptionEngineMessage) => void) => {
		engineSubs.add(fn);
		return () => engineSubs.delete(fn);
	},
	load: vi.fn(),
};

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

import { NewConsultationPage } from "./NewConsultationPage.tsx";

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

function makeApi(overrides: Partial<NewConsultationApi> = {}): NewConsultationApi {
	return {
		getLiveConsultation: vi.fn(async () => null),
		extractAnamnesis: vi.fn(async () => ({ anamnesis: ANAMNESIS, engine: "heuristic" })),
		attachAnamnesis: vi.fn(async () => ({ ok: true })),
		saveConsultation: vi.fn(async () => ({ id: 42 })),
		recordConsent: vi.fn(async () => ({ ok: true })),
		createPatient: vi.fn(async () => ({ id: 7, name: "Ana" })),
		...overrides,
	} as NewConsultationApi;
}

const PATIENTS = [
	{ id: 1, name: "Maria" },
	{ id: 2, name: "João" },
];

function renderPage(api = makeApi(), patients = PATIENTS) {
	return render(<NewConsultationPage initialPatients={patients} api={api} backend={backend} />);
}

async function consent(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByText(/I declare that the patient/));
}

async function fillTranscript(text = "paciente relata dor") {
	fireEvent.change(screen.getByLabelText("Consultation text"), { target: { value: text } });
}

async function generateAnamnesis(user: ReturnType<typeof userEvent.setup>) {
	await fillTranscript();
	await user.click(screen.getByText("Generate anamnesis →"));
	await screen.findByText("high confidence");
}

describe("NewConsultationPage", () => {
	beforeEach(() => {
		micSupported = true;
		micCb = null;
		tabCb = null;
		micStatsFn = null;
		micRecFn = null;
		tabStatsFn = null;
		tabRecFn = null;
		statusImpl = () => ({ state: "idle", device: null });
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
		expect(screen.getByText("New consultation")).toBeTruthy();
		expect(screen.getByText(/structured anamnesis appears here/)).toBeTruthy();
		expect(screen.getByText("Prepare")).toBeTruthy();
		expect(screen.getByText("Transcribe")).toBeTruthy();
		expect(screen.getByText("Review")).toBeTruthy();
	});

	it("creates a new patient", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await user.type(screen.getByLabelText("New patient name"), "Ana");
		await user.click(screen.getByText("+ patient"));
		await waitFor(() => expect(api.createPatient).toHaveBeenCalledWith({ data: "Ana" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Patient") as HTMLSelectElement).value).toBe("7"),
		);
	});

	it("ignores empty patient name", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await user.click(screen.getByText("+ patient"));
		expect(api.createPatient).not.toHaveBeenCalled();
	});

	it("handles createPatient returning null", async () => {
		const user = userEvent.setup();
		const api = makeApi({ createPatient: vi.fn(async () => null) });
		renderPage(api);
		await user.type(screen.getByLabelText("New patient name"), "X");
		await user.click(screen.getByText("+ patient"));
		await waitFor(() => expect(api.createPatient).toHaveBeenCalled());
	});

	it("selects an existing patient and toggles consent", async () => {
		const user = userEvent.setup();
		renderPage();
		fireEvent.change(screen.getByLabelText("Patient"), { target: { value: "2" } });
		expect((screen.getByLabelText("Patient") as HTMLSelectElement).value).toBe("2");
		await consent(user);
		const cb = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(cb.checked).toBe(true);
		await user.click(screen.getByText(/I declare that the patient/));
		expect(cb.checked).toBe(false);
	});

	it("switches source tabs", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByText("Upload"));
		expect(screen.getByText("Upload recording")).toBeTruthy();
		await user.click(screen.getByText("Teleconsult (bot)"));
		expect(screen.getByLabelText("Teleconsult link")).toBeTruthy();
		await user.click(screen.getByText("Record"));
		expect(screen.getByText("Record microphone")).toBeTruthy();
	});

	it("shows consent warning and disables recording until consent", async () => {
		const user = userEvent.setup();
		renderPage();
		expect(screen.getByText(/Check the consent box above/)).toBeTruthy();
		const btn = screen.getByText("Record microphone").closest("button")!;
		expect(btn.disabled).toBe(true);
		await consent(user);
		expect(btn.disabled).toBe(false);
	});

	it("shows unsupported message when whisper unsupported", () => {
		micSupported = false;
		renderPage();
		expect(screen.getByText(/Recording is not supported/)).toBeTruthy();
	});

	it("mic recording lifecycle: start, partial, final, stop", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Record microphone"));
		expect(micCb).not.toBeNull();
		expect(screen.getByText("Stop microphone")).toBeTruthy();
		expect(screen.getByText(/recording… speak normally/)).toBeTruthy();

		act(() => micCb!({ type: "partial", text: "acha que" }));
		await screen.findByText(/acha que…/);
		act(() => micCb!({ type: "final", text: "tem febre" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toContain(
				"Doctor: tem febre",
			),
		);

		await user.click(screen.getByText("Stop microphone"));
		expect(micStop).toHaveBeenCalled();
		expect(screen.getByText("Record microphone")).toBeTruthy();
	});

	it("mic error event sets error and stops recording", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Record microphone"));
		act(() => micCb!({ type: "error", message: "mic denied" }));
		await screen.findByText("mic denied");
		expect(screen.getByText("Record microphone")).toBeTruthy();
	});

	it("mic end event stops recording", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Record microphone"));
		act(() => micCb!({ type: "end" }));
		expect(screen.getByText("Record microphone")).toBeTruthy();
	});

	it("tab capture lifecycle appends Patient lines", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capture call tab"));
		expect(tabCb).not.toBeNull();
		act(() => tabCb!({ type: "final", text: "oi doutor" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toContain(
				"Patient: oi doutor",
			),
		);
		await user.click(screen.getByText("Stop tab"));
		expect(tabStop).toHaveBeenCalled();
	});

	it("tab error event sets error", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capture call tab"));
		act(() => tabCb!({ type: "error", message: "no tab" }));
		await screen.findByText("no tab");
		expect(screen.getByText("Capture call tab")).toBeTruthy();
	});

	it("tab end event stops capture", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capture call tab"));
		act(() => tabCb!({ type: "end" }));
		expect(screen.getByText("Capture call tab")).toBeTruthy();
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
			expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toBe(
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
		await screen.findByText(/transcription failed \(500\)/);
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
				.mockResolvedValueOnce({ transcript: "Doctor: oi", status: "live" })
				.mockResolvedValue({ transcript: "Doctor: oi\nPaciente: olá", status: "done" }),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ consultationId: 9, provider: "stub" }),
			})),
		);
		renderPage(api);
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "https://meet.google.com/abc");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/consultation #9/);
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
		await user.click(screen.getByText("Teleconsult (bot)"));
		const btn = screen.getByText("Send bot").closest("button")!;
		expect(btn.disabled).toBe(true);
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText("bad url");
	});

	it("sendBot handles missing consultationId in response", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
		);
		renderPage();
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/bot failed: HTTP 200/);
	});

	it("generates anamnesis", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await generateAnamnesis(user);
		expect(api.extractAnamnesis).toHaveBeenCalled();
		expect(screen.getByText("engine: heuristic")).toBeTruthy();
	});

	it("passes the selected patientId to extraction", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		fireEvent.change(screen.getByLabelText("Patient"), { target: { value: "2" } });
		await generateAnamnesis(user);
		expect(api.extractAnamnesis).toHaveBeenCalledWith({
			data: { transcript: "paciente relata dor", patientId: 2 },
		});
	});

	it("renders the historico block when the anamnesis carries one", async () => {
		const user = userEvent.setup();
		const withHistory: Anamnesis = {
			...ANAMNESIS,
			historico: {
				content: 'Consultas anteriores (1):\n- 05/03/2026 (#8): queixa "Febre"',
				confidence: "alta",
				evidence: ["consulta #8"],
			},
		};
		const api = makeApi({
			extractAnamnesis: vi.fn(async () => ({ anamnesis: withHistory, engine: "heuristic" })),
		});
		renderPage(api);
		await generateAnamnesis(user);
		expect(screen.getByText("Prior consultations")).toBeTruthy();
		expect(screen.getByText(/Consultas anteriores \(1\)/)).toBeTruthy();
	});

	it("generate guards empty transcript and surfaces errors", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			extractAnamnesis: vi.fn(async () => {
				throw new Error("llm down");
			}),
		});
		renderPage(api);
		const btn = screen.getByText("Generate anamnesis →").closest("button")!;
		expect(btn.disabled).toBe(true);
		await fillTranscript("algo");
		await user.click(screen.getByText("Generate anamnesis →"));
		await screen.findByText("llm down");
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
		expect(screen.getByText(/evidence \(1\)/)).toBeTruthy();
	});

	it("copies anamnesis to clipboard", async () => {
		const user = userEvent.setup();
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Copy"));
		await waitFor(() => expect(writeText).toHaveBeenCalled());
		await screen.findByText(/Anamnesis copied/);
		await user.click(screen.getByLabelText("Dismiss notification"));
		await waitFor(() => expect(screen.queryByText(/Anamnesis copied/)).toBeNull());
	});

	it("copy failure sets error", async () => {
		const user = userEvent.setup();
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
			configurable: true,
		});
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Copy"));
		await screen.findByText(/Could not copy/);
	});

	it("saves a new consultation with consent", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		await consent(user);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Anamnesis saved successfully");
		expect(api.saveConsultation).toHaveBeenCalled();
		expect(api.recordConsent).toHaveBeenCalledWith({ data: 42 });
		// dialog actions
		expect(screen.getByText("Download PDF")).toBeTruthy();
		expect(screen.getByText("View consultation")).toBeTruthy();
		await user.click(screen.getByText("Confirm"));
		// now shows update label
		await user.click(screen.getByText("Update consultation"));
		await screen.findByText("Consultation updated");
		expect(api.attachAnamnesis).toHaveBeenCalled();
	});

	it("save without consent skips recordConsent", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api, []);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Anamnesis saved successfully");
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
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("db gone");
		await user.click(screen.getByText("Got it"));
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
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/consultation #5/);
		await fillTranscript("transcrição da call");
		await user.click(screen.getByText("Generate anamnesis →"));
		await screen.findByText("high confidence");
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Consultation updated");
		expect(api.attachAnamnesis).toHaveBeenCalled();
		expect(api.saveConsultation).not.toHaveBeenCalled();
	});

	it("updated save dialog shows consent note", async () => {
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
		await consent(user);
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/consultation #5/);
		await fillTranscript("transcrição da call");
		await user.click(screen.getByText("Generate anamnesis →"));
		await screen.findByText("high confidence");
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Consultation updated");
		expect(document.body.textContent).toContain("Patient consent recorded");
		expect(document.body.textContent).not.toContain("second opinion");
	});

	it("save dialog never mentions second opinion", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		const dialog = await screen.findByText("Anamnesis saved successfully");
		expect(dialog.textContent).not.toContain("second opinion");
		expect(dialog.textContent).not.toContain("Patient consent");
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
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Could not save");
		expect(screen.getByText("string error")).toBeTruthy();
	});

	it("dialog closes via backdrop click", async () => {
		const user = userEvent.setup();
		renderPage();
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Anamnesis saved successfully");
		const dialog = document.querySelector("dialog") as HTMLDialogElement;
		expect(dialog.open).toBe(true);
		// click directly on the dialog element = backdrop
		fireEvent.click(dialog);
		await waitFor(() => expect(dialog.open).toBe(false));
	});

	it("sample transcript and clear buttons", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.click(screen.getByText("Use sample"));
		const ta = screen.getByLabelText("Consultation text") as HTMLTextAreaElement;
		expect(ta.value.length).toBeGreaterThan(50);
		await user.click(screen.getByText("Clear"));
		expect(ta.value).toBe("");
	});

	it("textarea onChange updates transcript", async () => {
		const user = userEvent.setup();
		renderPage();
		await user.type(screen.getByLabelText("Consultation text"), "digitado");
		expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toBe(
			"digitado",
		);
	});

	it("engine label renders", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			extractAnamnesis: vi.fn(async () => ({ anamnesis: ANAMNESIS, engine: "openai:gpt" })),
		});
		renderPage(api);
		await generateAnamnesis(user);
		expect(screen.getByText("engine: openai:gpt")).toBeTruthy();
	});

	it("model status updates from engine messages", async () => {
		renderPage();
		for (const fn of engineSubs) fn({ type: "progress", message: "baixando 50%" });
		await screen.findByText(/baixando 50%/);
		for (const fn of engineSubs) fn({ type: "ready", device: "webgpu" });
		await screen.findByText(/model ready \(webgpu\)/);
		for (const fn of engineSubs) fn({ type: "error", message: "falhou tudo" });
		await screen.findByText(/model unavailable: falhou tudo/);
	});

	it("live consultation done stops polling and shows call ended", async () => {
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
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/call ended/, {}, { timeout: 4000 });
	});

	it("shows ready model status on mount when engine already loaded", () => {
		statusImpl = () => ({ state: "ready", device: "webgpu" });
		renderPage();
		expect(screen.getByText(/model ready \(webgpu\)/)).toBeTruthy();
	});

	it("progress engine message without text clears status", async () => {
		renderPage();
		for (const fn of engineSubs) fn({ type: "progress" });
		for (const fn of engineSubs) fn({ type: "progress", message: "quase" });
		await screen.findByText(/quase/);
	});

	it("poll skips null live consultation responses", async () => {
		const user = userEvent.setup();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const api = makeApi({
			getLiveConsultation: vi.fn(async () => null),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ consultationId: 4, provider: "stub" }),
			})),
		);
		renderPage(api);
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/consultation #4/);
		await vi.advanceTimersByTimeAsync(3200);
		expect(api.getLiveConsultation).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("appends upload transcript to existing text", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ text: "via upload" }),
			})),
		);
		renderPage();
		await fillTranscript("existente");
		await user.click(screen.getByText("Upload"));
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [new File(["x"], "a.webm")] } });
		await waitFor(() =>
			expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toBe(
				"existente\nvia upload",
			),
		);
	});

	it("upload reports generic error for non-Error json failure", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => {
					throw "bad-json";
				},
			})),
		);
		renderPage();
		await user.click(screen.getByText("Upload"));
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		fireEvent.change(input, { target: { files: [new File(["x"], "a.webm")] } });
		await screen.findByText("transcription failed");
	});

	it("mic final events join with newlines", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Record microphone"));
		act(() => micCb!({ type: "final", text: "primeira" }));
		act(() => micCb!({ type: "final", text: "segunda" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toBe(
				"Doctor: primeira\nDoctor: segunda",
			),
		);
	});

	it("tab partial and consecutive finals", async () => {
		const user = userEvent.setup();
		renderPage();
		await consent(user);
		await user.click(screen.getByText("Capture call tab"));
		act(() => tabCb!({ type: "partial", text: "parcial aba" }));
		await screen.findByText(/parcial aba/);
		act(() => tabCb!({ type: "final", text: "um" }));
		act(() => tabCb!({ type: "final", text: "dois" }));
		await waitFor(() =>
			expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toBe(
				"Patient: um\nPatient: dois",
			),
		);
	});

	it("generate surfaces non-Error extractor failures", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			extractAnamnesis: vi.fn(async () => {
				throw "extractor-string";
			}),
		});
		renderPage(api);
		await fillTranscript("algo");
		await user.click(screen.getByText("Generate anamnesis →"));
		await screen.findByText("extractor-string");
	});

	it("save sends engine unknown and attach failure shows session error", async () => {
		const user = userEvent.setup();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ consultationId: 8, provider: "stub" }),
			})),
		);
		const api = makeApi({
			extractAnamnesis: vi.fn(async () => ({ anamnesis: ANAMNESIS, engine: undefined as never })),
			attachAnamnesis: vi.fn(async () => ({ ok: false })),
		});
		renderPage(api);
		await user.click(screen.getByText("Teleconsult (bot)"));
		await user.type(screen.getByLabelText("Teleconsult link"), "http://x");
		await user.click(screen.getByText("Send bot"));
		await screen.findByText(/consultation #8/);
		await fillTranscript("transcrição");
		await user.click(screen.getByText("Generate anamnesis →"));
		await screen.findByText("high confidence");
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText(/session expired/);
		expect(api.attachAnamnesis).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ engine: "unknown" }),
			}),
		);
	});

	it("save without id in response throws", async () => {
		const user = userEvent.setup();
		const api = makeApi({
			saveConsultation: vi.fn(async () => ({})) as never,
			extractAnamnesis: vi.fn(async () => ({ anamnesis: ANAMNESIS, engine: undefined as never })),
		});
		renderPage(api);
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText(/could not save/);
		expect(api.saveConsultation).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ engine: "unknown" }),
			}),
		);
	});

	it("clearing patient select sets patientId null", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		renderPage(api);
		fireEvent.change(screen.getByLabelText("Patient"), { target: { value: "1" } });
		fireEvent.change(screen.getByLabelText("Patient"), { target: { value: "" } });
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Anamnesis saved successfully");
		expect(api.saveConsultation).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ patientId: undefined }) }),
		);
	});

	it("sendBot and generate guards reject empty input via disabled-button clicks", async () => {
		const user = userEvent.setup();
		const api = makeApi();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		renderPage(api);
		await user.click(screen.getByText("Teleconsult (bot)"));
		// disabled button still dispatches click in jsdom → inner guard must hold
		fireEvent.click(screen.getByText("Send bot"));
		expect(fetchMock).not.toHaveBeenCalled();
		await user.click(screen.getByText("Record"));
		fireEvent.change(screen.getByLabelText("Consultation text"), { target: { value: "   " } });
		fireEvent.click(screen.getByText("Generate anamnesis →"));
		expect(api.extractAnamnesis).not.toHaveBeenCalled();
	});

	it("save dialog names the selected patient", async () => {
		const user = userEvent.setup();
		renderPage();
		fireEvent.change(screen.getByLabelText("Patient"), { target: { value: "1" } });
		await generateAnamnesis(user);
		await user.click(screen.getByText("Save consultation"));
		await screen.findByText("Anamnesis saved successfully");
		const dialog = document.querySelector("dialog") as HTMLDialogElement;
		expect(dialog.textContent).toContain("for Maria");
	});

	describe("post-consultation dictation", () => {
		async function enterDictation(user: ReturnType<typeof userEvent.setup>) {
			await user.click(screen.getByText("Post-consultation dictation"));
		}

		it("switches mode and shows dictation panel without source tabs", async () => {
			const user = userEvent.setup();
			renderPage();
			await enterDictation(user);
			expect(screen.getByText(/Narrate everything out loud/)).toBeTruthy();
			expect(screen.getByText("Start dictation")).toBeTruthy();
			expect(screen.queryByText("Teleconsult (bot)")).toBeNull();
			await user.click(screen.getByText("Live consultation"));
			expect(screen.getByText("Teleconsult (bot)")).toBeTruthy();
			expect(screen.queryByText("Start dictation")).toBeNull();
		});

		it("requires consent and shows warning", async () => {
			const user = userEvent.setup();
			renderPage();
			await enterDictation(user);
			expect(screen.getByText(/Check the consent box above to enable dictation/)).toBeTruthy();
			const btn = screen.getByText("Start dictation").closest("button")!;
			expect(btn.disabled).toBe(true);
			await consent(user);
			expect(btn.disabled).toBe(false);
			expect(screen.queryByText(/enable dictation/)).toBeNull();
		});

		it("shows unsupported message when mic unsupported", async () => {
			micSupported = false;
			const user = userEvent.setup();
			renderPage();
			await enterDictation(user);
			expect(screen.getByText(/Recording is not supported/)).toBeTruthy();
		});

		it("records narration: partial preview, final without prefix, stop", async () => {
			const user = userEvent.setup();
			renderPage();
			await consent(user);
			await enterDictation(user);
			await user.click(screen.getByText("Start dictation"));
			expect(micCb).not.toBeNull();
			expect(screen.getByText(/recording… 0:00/)).toBeTruthy();

			act(() => micCb!({ type: "partial", text: "narração parcial" }));
			await screen.findByText(/narração parcial…/);
			act(() => micCb!({ type: "final", text: "paciente relata dor de cabeça" }));
			act(() => micCb!({ type: "final", text: "sem febre" }));
			await waitFor(() =>
				expect((screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value).toBe(
					"paciente relata dor de cabeça\nsem febre",
				),
			);

			await user.click(screen.getByText(/Stop dictation/));
			expect(micStop).toHaveBeenCalled();
			expect(screen.getByText("Start dictation")).toBeTruthy();
			expect(screen.queryByText(/recording…/)).toBeNull();
		});

		it("elapsed clock ticks while dictating", async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			const user = userEvent.setup({
				advanceTimers: (ms) => vi.advanceTimersByTime(ms),
			});
			renderPage();
			await consent(user);
			await enterDictation(user);
			await user.click(screen.getByText("Start dictation"));
			await act(async () => {
				await vi.advanceTimersByTimeAsync(61_500);
			});
			expect(screen.getByText(/Stop dictation \(1:01\)/)).toBeTruthy();
			vi.useRealTimers();
		});

		it("dictation error and end events stop recording", async () => {
			const user = userEvent.setup();
			renderPage();
			await consent(user);
			await enterDictation(user);
			await user.click(screen.getByText("Start dictation"));
			act(() => micCb!({ type: "error", message: "dict mic denied" }));
			await screen.findByText("dict mic denied");
			expect(screen.getByText("Start dictation")).toBeTruthy();
			// restart, then engine end stops it
			await user.click(screen.getByText("Start dictation"));
			act(() => micCb!({ type: "end" }));
			expect(screen.getByText("Start dictation")).toBeTruthy();
		});

		it("dictated transcript feeds the anamnesis pipeline", async () => {
			const user = userEvent.setup();
			const api = makeApi();
			renderPage(api);
			await consent(user);
			await enterDictation(user);
			await user.click(screen.getByText("Start dictation"));
			act(() => micCb!({ type: "final", text: "narrei a consulta toda" }));
			await user.click(screen.getByText(/Stop dictation/));
			await user.click(screen.getByText("Generate anamnesis →"));
			await screen.findByText("high confidence");
			expect(api.extractAnamnesis).toHaveBeenCalledWith({
				data: { transcript: "narrei a consulta toda", patientId: undefined },
			});
		});
	});

	describe("server fallback on low confidence", () => {
		const LOW: SessionStats = { voicedSec: 10, chars: 5 };
		const HIGH: SessionStats = { voicedSec: 10, chars: 200 };
		const blob = new Blob(["audio"], { type: "audio/webm" });

		function transcriptValue() {
			return (screen.getByLabelText("Consultation text") as HTMLTextAreaElement).value;
		}

		async function flushFallback() {
			await act(async () => {
				await new Promise((r) => setTimeout(r, 0));
			});
		}

		it("mic session re-transcribes on the server and keeps the Doctor label", async () => {
			const user = userEvent.setup();
			const fetchMock = vi.fn(async () => ({
				ok: true,
				json: async () => ({ text: "transcrição do servidor" }),
			}));
			vi.stubGlobal("fetch", fetchMock);
			micStatsFn = () => LOW;
			micRecFn = async () => blob;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "final", text: "lixo local" }));
			act(() => micCb!({ type: "end" }));
			await waitFor(() => expect(transcriptValue()).toBe("Doctor: transcrição do servidor"));
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/transcribe",
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("splices the server result after pre-existing transcript", async () => {
			const user = userEvent.setup();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					ok: true,
					json: async () => ({ text: "só o trecho novo" }),
				})),
			);
			micStatsFn = () => LOW;
			micRecFn = async () => blob;
			renderPage();
			fireEvent.change(screen.getByLabelText("Consultation text"), {
				target: { value: "anotação anterior" },
			});
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "final", text: "lixo local" }));
			act(() => micCb!({ type: "end" }));
			await waitFor(() =>
				expect(transcriptValue()).toBe("anotação anterior\nDoctor: só o trecho novo"),
			);
		});

		it("tab session falls back with the Patient label", async () => {
			const user = userEvent.setup();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					ok: true,
					json: async () => ({ text: "paciente no servidor" }),
				})),
			);
			tabStatsFn = () => LOW;
			tabRecFn = async () => blob;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Capture call tab"));
			act(() => tabCb!({ type: "final", text: "lixo" }));
			act(() => tabCb!({ type: "end" }));
			await waitFor(() => expect(transcriptValue()).toBe("Patient: paciente no servidor"));
		});

		it("dictation falls back without a speaker label", async () => {
			const user = userEvent.setup();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					ok: true,
					json: async () => ({ text: "narração refeita" }),
				})),
			);
			micStatsFn = () => LOW;
			micRecFn = async () => blob;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Post-consultation dictation"));
			await user.click(screen.getByText("Start dictation"));
			act(() => micCb!({ type: "final", text: "lixo local" }));
			act(() => micCb!({ type: "end" }));
			await waitFor(() => expect(transcriptValue()).toBe("narração refeita"));
		});

		it("does not fall back when confidence is healthy", async () => {
			const user = userEvent.setup();
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			micStatsFn = () => HIGH;
			micRecFn = async () => blob;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "final", text: "transcrição boa" }));
			act(() => micCb!({ type: "end" }));
			await flushFallback();
			await waitFor(() => expect(transcriptValue()).toBe("Doctor: transcrição boa"));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("does not fall back without a recording to upload", async () => {
			const user = userEvent.setup();
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			micStatsFn = () => LOW;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "end" }));
			await flushFallback();
			await waitFor(() => expect(screen.getByText("Record microphone")).toBeTruthy());
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("keeps the local transcript when the recording is empty", async () => {
			const user = userEvent.setup();
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			micStatsFn = () => LOW;
			micRecFn = async () => null;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "final", text: "local fica" }));
			act(() => micCb!({ type: "end" }));
			await flushFallback();
			await waitFor(() => expect(transcriptValue()).toBe("Doctor: local fica"));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("keeps the local transcript when the server returns empty text", async () => {
			const user = userEvent.setup();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({ ok: true, json: async () => ({ text: "   " }) })),
			);
			micStatsFn = () => LOW;
			micRecFn = async () => blob;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "final", text: "local fica" }));
			act(() => micCb!({ type: "end" }));
			await flushFallback();
			await waitFor(() => expect(transcriptValue()).toBe("Doctor: local fica"));
		});

		it("keeps the local transcript when the upload fails", async () => {
			const user = userEvent.setup();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => {
					throw new Error("network down");
				}),
			);
			micStatsFn = () => LOW;
			micRecFn = async () => blob;
			renderPage();
			await consent(user);
			await user.click(screen.getByText("Record microphone"));
			act(() => micCb!({ type: "final", text: "local fica" }));
			act(() => micCb!({ type: "end" }));
			await flushFallback();
			await waitFor(() => expect(transcriptValue()).toBe("Doctor: local fica"));
		});
	});
});
