/**
 * Consultations plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint), so the host passes the
 * active locale in (route loader data / panel ctx / header-action prop)
 * and every view resolves its strings here. A locale catalog must
 * implement `ConsultationMessages` in full — a missing key is a type
 * error, not an English fallback at runtime.
 *
 * Pure module (no React): also used by -ui.ts-style label lookups.
 */
import type { AnamnesisSectionKey, Confidence } from "@ktb/anamnesis";

/** Locales with a catalog; the host asserts it covers every app locale. */
export const CONSULTATION_LOCALES = ["en", "pt-BR", "es"] as const;
export type ConsultationLocale = (typeof CONSULTATION_LOCALES)[number];
export const BASE_LOCALE: ConsultationLocale = "en";

export interface ConsultationMessages {
	/** Capture-source labels (also used for notification bodies upstream). */
	readonly sources: Record<"browser" | "bot" | "dictation" | "upload", string>;
	/** Speaker labels written into transcripts and matched back for styling. */
	readonly speakers: { readonly doctor: string; readonly patient: string };
	/** Anamnesis section headings, keyed by the persisted section ids. */
	readonly sections: Record<AnamnesisSectionKey, string> & { readonly historico: string };
	readonly confidence: Record<Confidence, string>;
	readonly common: {
		readonly consultations: string;
		readonly anamnesis: string;
		readonly transcript: string;
		readonly noTranscript: string;
		readonly copy: string;
		readonly downloadPdf: string;
		readonly engine: (engine: string) => string;
		readonly consultationId: (id: number | string) => string;
	};
	readonly list: {
		readonly title: string;
		readonly none: string;
		readonly count: (n: number) => string;
		readonly newConsultation: string;
		readonly searchPlaceholder: string;
		readonly searchLabel: string;
		readonly filterLabel: string;
		readonly filters: {
			readonly all: string;
			readonly anamnesis: string;
			readonly pending: string;
		};
		readonly unlinkedPatient: string;
		readonly patientRecord: string;
		readonly live: string;
		readonly noAnamnesis: string;
		readonly consent: string;
		readonly downloadPdfTitle: string;
		readonly open: string;
		readonly noMatch: string;
		readonly emptyTitle: string;
		readonly emptyDescription: string;
		readonly startConsultation: string;
	};
	readonly detail: {
		readonly back: string;
		readonly openPatientRecord: string;
		readonly consentRecorded: (date: string) => string;
		readonly consentNotRecorded: string;
		readonly inProgress: string;
		readonly previousConsultations: (n: number) => string;
		readonly anamnesisCopied: string;
		readonly complaint: (text: string) => string;
		readonly plan: (text: string) => string;
		readonly historyNote: string;
		readonly notReported: string;
		readonly evidence: (n: number) => string;
		readonly noAnamnesisTitle: string;
		readonly noAnamnesisDescription: string;
	};
	readonly transcriptPanel: {
		readonly sourceServer: string;
		readonly sourceBrowser: string;
		readonly sourceCorrected: string;
		readonly enhancementFailed: string;
		readonly audioStored: string;
		readonly enhancing: string;
		readonly enhanced: string;
		readonly audioLabel: string;
		readonly tabCorrected: string;
		readonly tabOriginal: string;
	};
	readonly newConsultation: {
		readonly title: string;
		readonly subtitle: string;
		readonly steps: {
			readonly prepare: string;
			readonly transcribe: string;
			readonly review: string;
		};
		readonly modeLabel: string;
		readonly modeLive: string;
		readonly modeDictation: string;
		readonly patientLabel: string;
		readonly unlinked: string;
		readonly newPatientPlaceholder: string;
		readonly newPatientNameLabel: string;
		readonly agePlaceholder: string;
		readonly newPatientAgeLabel: string;
		readonly ageRequired: string;
		readonly patientCreateFailed: string;
		readonly addPatient: string;
		readonly completeRecord: string;
		readonly consentDeclaration: string;
		readonly tabRecord: string;
		readonly tabUpload: string;
		readonly tabBot: string;
		readonly dictationDescription: string;
		readonly stopDictation: (elapsed: string) => string;
		readonly startDictation: string;
		readonly dictatingHint: (elapsed: string) => string;
		readonly consentRequiredDictation: string;
		readonly consentRequiredRecording: string;
		readonly unsupportedBrowser: string;
		readonly uploading: string;
		readonly uploadRecording: string;
		readonly uploadHint: string;
		readonly recordMic: string;
		readonly stopMic: string;
		readonly micHint: (doctor: string) => string;
		readonly captureTab: string;
		readonly stopTab: string;
		readonly tabHint: (patient: string) => string;
		readonly recordingTip: string;
		readonly channelsBadge: string;
		readonly botDescription: string;
		readonly teleconsultLinkLabel: string;
		readonly sendBot: string;
		readonly botInCall: string;
		readonly consultationLive: (id: number, status: string) => string;
		readonly transcribingLive: string;
		readonly callEnded: string;
		readonly recordingSpeak: string;
		readonly consultationText: string;
		readonly useSample: string;
		readonly clear: string;
		readonly transcriptPlaceholder: string;
		readonly serverTranscript: string;
		readonly generating: string;
		readonly generate: string;
		readonly generatedFrom: (source: string) => string;
		readonly modelReady: (device: string | null | undefined) => string;
		readonly modelUnavailable: (message: string) => string;
		readonly lowConfidenceReprocessing: string;
		readonly transcriptionRedone: string;
		readonly engineLabel: (engine: string) => string;
		readonly waitingTitle: string;
		readonly waitingDescription: string;
		readonly saving: string;
		readonly saveConsultation: string;
		readonly updateConsultation: string;
		readonly dialogErrorTitle: string;
		readonly dialogUpdatedTitle: string;
		readonly dialogSavedTitle: string;
		readonly viewConsultation: string;
		readonly confirm: string;
		readonly gotIt: string;
		/** Portal access question in the save dialog — `patient` is the
		 * patient's name, `email` the address the access went to. */
		readonly accessQuestion: (patient: string) => string;
		readonly accessHint: string;
		readonly accessEmailPlaceholder: string;
		readonly accessSend: string;
		readonly accessNotNow: string;
		readonly accessSent: (email: string) => string;
		readonly accessUnsent: (email: string) => string;
		readonly accessInvalidEmail: string;
		readonly accessFailed: string;
		readonly dialogSavedBody: (args: {
			id: number;
			patientName: string | null;
			updated: boolean;
			consented: boolean;
		}) => string;
		readonly saveSessionExpired: string;
		readonly saveFailed: string;
		readonly anamnesisCopied: string;
		readonly copyFailed: string;
		readonly audioUploadFailed: (message: string) => string;
		readonly transcriptionFailedStatus: (status: number | string) => string;
		readonly transcriptionFailed: string;
		readonly botFailed: (status: number) => string;
		readonly patientFallback: string;
	};
	readonly admin: {
		readonly title: string;
		readonly none: string;
		readonly count: (n: number) => string;
		readonly emptyTitle: string;
		readonly emptyDescription: string;
		readonly colId: string;
		readonly colStatus: string;
		readonly colSource: string;
		readonly colPatient: string;
		readonly colOwner: string;
		readonly colAudio: string;
		readonly colCreated: string;
		readonly searchPlaceholder: string;
		readonly searchLabel: string;
		readonly noMatch: string;
		readonly filteredCount: (shown: number, total: number) => string;
		readonly colActions: string;
		readonly newConsultation: string;
		readonly createTitle: string;
		readonly createDescription: string;
		readonly createFailed: string;
		readonly ownerLabel: string;
		readonly ownerPlaceholder: string;
		readonly patientLabel: string;
		readonly patientPlaceholder: string;
		readonly patientNone: string;
		readonly transcriptLabel: string;
		readonly transcriptPlaceholder: string;
		readonly deleteFor: (label: string) => string;
		readonly deleteTitle: string;
		readonly deleteDescription: (label: string) => string;
		readonly deleteConfirm: string;
		readonly cancel: string;
	};
}

const en: ConsultationMessages = {
	sources: {
		browser: "Browser voice",
		bot: "Teleconsult (bot)",
		dictation: "Dictation",
		upload: "Upload",
	},
	speakers: { doctor: "Doctor", patient: "Patient" },
	sections: {
		queixa_principal: "Chief complaint",
		hda: "History of present illness",
		antecedentes: "Past medical history",
		alergias: "Allergies",
		medicamentos_em_uso: "Current medications",
		exame_fisico: "Physical examination",
		hipoteses: "Diagnostic hypotheses",
		conduta: "Management plan",
		historico: "Prior consultations",
	},
	confidence: { alta: "high confidence", media: "medium confidence", baixa: "low confidence" },
	common: {
		consultations: "Consultations",
		anamnesis: "Anamnesis",
		transcript: "Transcript",
		noTranscript: "No transcript.",
		copy: "Copy",
		downloadPdf: "Download PDF",
		engine: (engine) => `engine: ${engine}`,
		consultationId: (id) => `Consultation #${id}`,
	},
	list: {
		title: "Consultations",
		none: "No consultations yet.",
		count: (n) => `${n} consultation${n === 1 ? "" : "s"} recorded.`,
		newConsultation: "+ New consultation",
		searchPlaceholder: "Search by patient, complaint, or text…",
		searchLabel: "Search consultations",
		filterLabel: "Filter consultations",
		filters: { all: "All", anamnesis: "With anamnesis", pending: "Pending" },
		unlinkedPatient: "Unlinked patient",
		patientRecord: "Patient record",
		live: "live",
		noAnamnesis: "No anamnesis",
		consent: "Consent ✓",
		downloadPdfTitle: "Download anamnesis PDF",
		open: "Open",
		noMatch: "No consultations match the search.",
		emptyTitle: "No consultations yet",
		emptyDescription: "Start a consultation to record the conversation and generate the anamnesis.",
		startConsultation: "Start consultation",
	},
	detail: {
		back: "Consultations",
		openPatientRecord: "Open patient record",
		consentRecorded: (date) => `Consent ✓ ${date}`,
		consentNotRecorded: "Consent not recorded",
		inProgress: "in progress",
		previousConsultations: (n) => `${n} previous consultation${n === 1 ? "" : "s"}`,
		anamnesisCopied: "Anamnesis copied",
		complaint: (text) => `Complaint: ${text}`,
		plan: (text) => `Plan: ${text}`,
		historyNote: "Factual record of prior consultations — context only, not clinical suggestions.",
		notReported: "Not reported",
		evidence: (n) => `evidence (${n})`,
		noAnamnesisTitle: "No anamnesis saved",
		noAnamnesisDescription: "This consultation does not have a saved anamnesis yet.",
	},
	transcriptPanel: {
		sourceServer: "server · whisper large-v3-turbo",
		sourceBrowser: "browser",
		sourceCorrected: "llm corrected",
		enhancementFailed: "enhancement failed — showing original",
		audioStored: "audio stored",
		enhancing: "enhancing transcript…",
		enhanced: "enhanced ✓",
		audioLabel: "Consultation audio",
		tabCorrected: "Corrected",
		tabOriginal: "Original",
	},
	newConsultation: {
		title: "New consultation",
		subtitle:
			"Record the conversation or paste the transcript. The anamnesis comes out structured for review.",
		steps: { prepare: "Prepare", transcribe: "Transcribe", review: "Review" },
		modeLabel: "Consultation mode",
		modeLive: "Live consultation",
		modeDictation: "Post-consultation dictation",
		patientLabel: "Patient",
		unlinked: "unlinked",
		newPatientPlaceholder: "new patient",
		newPatientNameLabel: "New patient name",
		agePlaceholder: "age",
		newPatientAgeLabel: "New patient age",
		ageRequired: "Enter the patient's age.",
		patientCreateFailed: "Could not register the patient.",
		addPatient: "+ patient",
		completeRecord: "Complete the record",
		consentDeclaration: "I declare that the patient was informed and consented to the recording",
		tabRecord: "Record",
		tabUpload: "Upload",
		tabBot: "Teleconsult (bot)",
		dictationDescription:
			"The consultation already happened? Narrate everything out loud, as if explaining the case, in a single voice (yours): chief complaint, history, exam, and plan. The narration becomes the transcript that generates the anamnesis.",
		stopDictation: (elapsed) => `Stop dictation (${elapsed})`,
		startDictation: "Start dictation",
		dictatingHint: (elapsed) => `recording… ${elapsed}. The transcript appears below in real time`,
		consentRequiredDictation: "Check the consent box above to enable dictation.",
		consentRequiredRecording: "Check the consent box above to enable recording.",
		unsupportedBrowser:
			"Recording is not supported in this browser. Use the sample or paste the text (Chrome/Edge support it).",
		uploading: "Transcribing…",
		uploadRecording: "Upload recording",
		uploadHint: "Audio transcribed on the server (Whisper)",
		recordMic: "Record microphone",
		stopMic: "Stop microphone",
		micHint: (doctor) => `Your voice, shown as “${doctor}”`,
		captureTab: "Capture call tab",
		stopTab: "Stop tab",
		tabHint: (patient) => `Call audio, shown as “${patient}”`,
		recordingTip:
			"Tip: enable both to separate doctor and patient, and use headphones so the microphone does not pick up the speakers.",
		channelsBadge: "free speaker labels via channels",
		botDescription:
			"The “KTB Health” bot joins your call (Meet/Zoom/Teams), transcribes with speaker separation, and generates the draft when the consultation ends.",
		teleconsultLinkLabel: "Teleconsult link",
		sendBot: "Send bot",
		botInCall: "bot in call…",
		consultationLive: (id, status) => `consultation #${id} · ${status}`,
		transcribingLive: "transcribing live",
		callEnded: "call ended",
		recordingSpeak: "recording… speak normally",
		consultationText: "Consultation text",
		useSample: "Use sample",
		clear: "Clear",
		transcriptPlaceholder: "The transcript appears here (or paste the consultation text)",
		serverTranscript: "Server transcript",
		generating: "Generating anamnesis…",
		generate: "Generate anamnesis →",
		generatedFrom: (source) => `anamnesis generated from the ${source} transcript`,
		modelReady: (device) => `model ready${device ? ` (${device})` : ""}`,
		modelUnavailable: (message) => `model unavailable: ${message}`,
		lowConfidenceReprocessing: "low confidence, reprocessing on the server…",
		transcriptionRedone: "transcription redone on the server",
		engineLabel: (engine) => `engine: ${engine}`,
		waitingTitle: "Waiting for anamnesis",
		waitingDescription:
			"The structured anamnesis appears here. Each section shows the confidence and the source sentences that ground it.",
		saving: "Saving…",
		saveConsultation: "Save consultation",
		updateConsultation: "Update consultation",
		dialogErrorTitle: "Could not save",
		dialogUpdatedTitle: "Consultation updated",
		dialogSavedTitle: "Anamnesis saved successfully",
		viewConsultation: "View consultation",
		confirm: "Confirm",
		gotIt: "Got it",
		accessQuestion: (patient) => `Send ${patient} the patient portal access email?`,
		accessHint:
			"The patient signs in with this email address to see the consultations you saved, read-only.",
		accessEmailPlaceholder: "patient@email.com",
		accessSend: "Send access email",
		accessNotNow: "Not now",
		accessSent: (email) => `Access email sent to ${email}.`,
		accessUnsent: (email) =>
			`Portal access granted to ${email}, but the email could not be sent. Ask the patient to sign in to the patient portal with this address.`,
		accessInvalidEmail: "Enter a valid email address.",
		accessFailed: "Could not send the access email. Please try again.",
		dialogSavedBody: ({ id, patientName, updated, consented }) =>
			`Consultation #${id}${patientName ? ` for ${patientName}` : ""} was ${updated ? "updated" : "saved"} with the reviewed anamnesis.${consented ? " Patient consent recorded." : ""}`,
		saveSessionExpired: "session expired. Reload the page",
		saveFailed: "could not save the consultation",
		anamnesisCopied: "Anamnesis copied to clipboard",
		copyFailed: "Could not copy. Select the text manually.",
		audioUploadFailed: (message) =>
			`Audio could not be uploaded (${message}). The consultation was saved without it.`,
		transcriptionFailedStatus: (status) => `transcription failed (${status})`,
		transcriptionFailed: "transcription failed",
		botFailed: (status) => `bot failed: HTTP ${status}`,
		patientFallback: "patient",
	},
	admin: {
		title: "Consultations",
		none: "No consultations yet.",
		count: (n) => `${n} consultation${n === 1 ? "" : "s"} across all owners.`,
		emptyTitle: "No consultations",
		emptyDescription: "Consultations appear here once created.",
		colId: "Id",
		colStatus: "Status",
		colSource: "Source",
		colPatient: "Patient",
		colOwner: "Owner",
		colAudio: "Audio",
		colCreated: "Created",
		searchPlaceholder: "Search by patient or owner…",
		searchLabel: "Search consultations",
		noMatch: "No consultations match the search.",
		filteredCount: (shown, total) => `Showing ${shown} of ${total}`,
		colActions: "Actions",
		newConsultation: "New consultation",
		createTitle: "New consultation",
		createDescription: "Create a consultation record on behalf of an owner.",
		createFailed: "Could not create the consultation. Try again.",
		ownerLabel: "Owner",
		ownerPlaceholder: "Select an owner",
		patientLabel: "Patient",
		patientPlaceholder: "Select a patient",
		patientNone: "No patient",
		transcriptLabel: "Transcript",
		transcriptPlaceholder: "Optional transcript text…",
		deleteFor: (label) => `Delete ${label}`,
		deleteTitle: "Delete consultation?",
		deleteDescription: (label) => `This permanently deletes ${label} and its recording.`,
		deleteConfirm: "Delete permanently",
		cancel: "Cancel",
	},
};

const ptBR: ConsultationMessages = {
	sources: {
		browser: "Voz do navegador",
		bot: "Teleconsulta (bot)",
		dictation: "Ditado",
		upload: "Upload",
	},
	speakers: { doctor: "Médico", patient: "Paciente" },
	sections: {
		queixa_principal: "Queixa principal",
		hda: "História da doença atual",
		antecedentes: "Antecedentes patológicos",
		alergias: "Alergias",
		medicamentos_em_uso: "Medicamentos em uso",
		exame_fisico: "Exame físico",
		hipoteses: "Hipóteses diagnósticas",
		conduta: "Conduta",
		historico: "Consultas anteriores",
	},
	confidence: { alta: "confiança alta", media: "confiança média", baixa: "confiança baixa" },
	common: {
		consultations: "Consultas",
		anamnesis: "Anamnese",
		transcript: "Transcrição",
		noTranscript: "Sem transcrição.",
		copy: "Copiar",
		downloadPdf: "Baixar PDF",
		engine: (engine) => `motor: ${engine}`,
		consultationId: (id) => `Consulta #${id}`,
	},
	list: {
		title: "Consultas",
		none: "Nenhuma consulta ainda.",
		count: (n) => `${n} consulta${n === 1 ? "" : "s"} registrada${n === 1 ? "" : "s"}.`,
		newConsultation: "+ Nova consulta",
		searchPlaceholder: "Buscar por paciente, queixa ou texto…",
		searchLabel: "Buscar consultas",
		filterLabel: "Filtrar consultas",
		filters: { all: "Todas", anamnesis: "Com anamnese", pending: "Pendentes" },
		unlinkedPatient: "Paciente não vinculado",
		patientRecord: "Cadastro do paciente",
		live: "ao vivo",
		noAnamnesis: "Sem anamnese",
		consent: "Consentimento ✓",
		downloadPdfTitle: "Baixar anamnese em PDF",
		open: "Abrir",
		noMatch: "Nenhuma consulta corresponde à busca.",
		emptyTitle: "Nenhuma consulta ainda",
		emptyDescription: "Inicie uma consulta para gravar a conversa e gerar a anamnese.",
		startConsultation: "Iniciar consulta",
	},
	detail: {
		back: "Consultas",
		openPatientRecord: "Abrir cadastro do paciente",
		consentRecorded: (date) => `Consentimento ✓ ${date}`,
		consentNotRecorded: "Consentimento não registrado",
		inProgress: "em andamento",
		previousConsultations: (n) =>
			`${n} consulta${n === 1 ? "" : "s"} anterior${n === 1 ? "" : "es"}`,
		anamnesisCopied: "Anamnese copiada",
		complaint: (text) => `Queixa: ${text}`,
		plan: (text) => `Conduta: ${text}`,
		historyNote:
			"Registro factual de consultas anteriores — apenas contexto, não sugestões clínicas.",
		notReported: "Não informado",
		evidence: (n) => `evidências (${n})`,
		noAnamnesisTitle: "Nenhuma anamnese salva",
		noAnamnesisDescription: "Esta consulta ainda não tem uma anamnese salva.",
	},
	transcriptPanel: {
		sourceServer: "servidor · whisper large-v3-turbo",
		sourceBrowser: "navegador",
		sourceCorrected: "corrigida por LLM",
		enhancementFailed: "falha na melhoria — exibindo original",
		audioStored: "áudio armazenado",
		enhancing: "melhorando transcrição…",
		enhanced: "melhorada ✓",
		audioLabel: "Áudio da consulta",
		tabCorrected: "Corrigida",
		tabOriginal: "Original",
	},
	newConsultation: {
		title: "Nova consulta",
		subtitle: "Grave a conversa ou cole a transcrição. A anamnese sai estruturada para revisão.",
		steps: { prepare: "Preparar", transcribe: "Transcrever", review: "Revisar" },
		modeLabel: "Modo da consulta",
		modeLive: "Consulta ao vivo",
		modeDictation: "Ditado pós-consulta",
		patientLabel: "Paciente",
		unlinked: "não vinculado",
		newPatientPlaceholder: "novo paciente",
		newPatientNameLabel: "Nome do novo paciente",
		agePlaceholder: "idade",
		newPatientAgeLabel: "Idade do novo paciente",
		ageRequired: "Informe a idade do paciente.",
		patientCreateFailed: "Não foi possível cadastrar o paciente.",
		addPatient: "+ paciente",
		completeRecord: "Completar o cadastro",
		consentDeclaration: "Declaro que o paciente foi informado e consentiu com a gravação",
		tabRecord: "Gravar",
		tabUpload: "Upload",
		tabBot: "Teleconsulta (bot)",
		dictationDescription:
			"A consulta já aconteceu? Narre tudo em voz alta, como se explicasse o caso, em uma única voz (a sua): queixa principal, história, exame e conduta. A narração vira a transcrição que gera a anamnese.",
		stopDictation: (elapsed) => `Parar ditado (${elapsed})`,
		startDictation: "Iniciar ditado",
		dictatingHint: (elapsed) => `gravando… ${elapsed}. A transcrição aparece abaixo em tempo real`,
		consentRequiredDictation: "Marque a caixa de consentimento acima para ativar o ditado.",
		consentRequiredRecording: "Marque a caixa de consentimento acima para ativar a gravação.",
		unsupportedBrowser:
			"A gravação não é suportada neste navegador. Use o exemplo ou cole o texto (Chrome/Edge suportam).",
		uploading: "Transcrevendo…",
		uploadRecording: "Enviar gravação",
		uploadHint: "Áudio transcrito no servidor (Whisper)",
		recordMic: "Gravar microfone",
		stopMic: "Parar microfone",
		micHint: (doctor) => `Sua voz, exibida como “${doctor}”`,
		captureTab: "Capturar aba da chamada",
		stopTab: "Parar aba",
		tabHint: (patient) => `Áudio da chamada, exibido como “${patient}”`,
		recordingTip:
			"Dica: ative os dois para separar médico e paciente, e use fones de ouvido para o microfone não captar as caixas de som.",
		channelsBadge: "vozes separadas por canais",
		botDescription:
			"O bot “KTB Health” entra na sua chamada (Meet/Zoom/Teams), transcreve com separação de vozes e gera o rascunho ao fim da consulta.",
		teleconsultLinkLabel: "Link da teleconsulta",
		sendBot: "Enviar bot",
		botInCall: "bot na chamada…",
		consultationLive: (id, status) => `consulta #${id} · ${status}`,
		transcribingLive: "transcrevendo ao vivo",
		callEnded: "chamada encerrada",
		recordingSpeak: "gravando… fale normalmente",
		consultationText: "Texto da consulta",
		useSample: "Usar exemplo",
		clear: "Limpar",
		transcriptPlaceholder: "A transcrição aparece aqui (ou cole o texto da consulta)",
		serverTranscript: "Transcrição do servidor",
		generating: "Gerando anamnese…",
		generate: "Gerar anamnese →",
		generatedFrom: (source) => `anamnese gerada a partir da transcrição ${source}`,
		modelReady: (device) => `modelo pronto${device ? ` (${device})` : ""}`,
		modelUnavailable: (message) => `modelo indisponível: ${message}`,
		lowConfidenceReprocessing: "confiança baixa, reprocessando no servidor…",
		transcriptionRedone: "transcrição refeita no servidor",
		engineLabel: (engine) => `motor: ${engine}`,
		waitingTitle: "Aguardando anamnese",
		waitingDescription:
			"A anamnese estruturada aparece aqui. Cada seção mostra a confiança e as frases de origem que a sustentam.",
		saving: "Salvando…",
		saveConsultation: "Salvar consulta",
		updateConsultation: "Atualizar consulta",
		dialogErrorTitle: "Não foi possível salvar",
		dialogUpdatedTitle: "Consulta atualizada",
		dialogSavedTitle: "Anamnese salva com sucesso",
		viewConsultation: "Ver consulta",
		confirm: "Confirmar",
		gotIt: "Entendi",
		accessQuestion: (patient) => `Enviar para ${patient} o e-mail de acesso ao portal do paciente?`,
		accessHint:
			"O paciente entra com este e-mail para ver, somente para leitura, as consultas que você salvou.",
		accessEmailPlaceholder: "paciente@email.com",
		accessSend: "Enviar e-mail de acesso",
		accessNotNow: "Agora não",
		accessSent: (email) => `E-mail de acesso enviado para ${email}.`,
		accessUnsent: (email) =>
			`Acesso ao portal liberado para ${email}, mas o e-mail não pôde ser enviado. Peça ao paciente que entre no portal do paciente com este endereço.`,
		accessInvalidEmail: "Informe um e-mail válido.",
		accessFailed: "Não foi possível enviar o e-mail de acesso. Tente novamente.",
		dialogSavedBody: ({ id, patientName, updated, consented }) =>
			`A consulta #${id}${patientName ? ` de ${patientName}` : ""} foi ${updated ? "atualizada" : "salva"} com a anamnese revisada.${consented ? " Consentimento do paciente registrado." : ""}`,
		saveSessionExpired: "sessão expirada. Recarregue a página",
		saveFailed: "não foi possível salvar a consulta",
		anamnesisCopied: "Anamnese copiada para a área de transferência",
		copyFailed: "Não foi possível copiar. Selecione o texto manualmente.",
		audioUploadFailed: (message) =>
			`Não foi possível enviar o áudio (${message}). A consulta foi salva sem ele.`,
		transcriptionFailedStatus: (status) => `transcrição falhou (${status})`,
		transcriptionFailed: "falha na transcrição",
		botFailed: (status) => `bot falhou: HTTP ${status}`,
		patientFallback: "paciente",
	},
	admin: {
		title: "Consultas",
		none: "Nenhuma consulta ainda.",
		count: (n) => `${n} consulta${n === 1 ? "" : "s"} em toda a plataforma.`,
		emptyTitle: "Nenhuma consulta",
		emptyDescription: "As consultas aparecem aqui após serem criadas.",
		colId: "Id",
		colStatus: "Status",
		colSource: "Origem",
		colPatient: "Paciente",
		colOwner: "Proprietário",
		colAudio: "Áudio",
		colCreated: "Criada em",
		searchPlaceholder: "Buscar por paciente ou proprietário…",
		searchLabel: "Buscar consultas",
		noMatch: "Nenhuma consulta corresponde à busca.",
		filteredCount: (shown, total) => `Exibindo ${shown} de ${total}`,
		colActions: "Ações",
		newConsultation: "Nova consulta",
		createTitle: "Nova consulta",
		createDescription: "Crie um registro de consulta em nome de um proprietário.",
		createFailed: "Não foi possível criar a consulta. Tente novamente.",
		ownerLabel: "Proprietário",
		ownerPlaceholder: "Selecione um proprietário",
		patientLabel: "Paciente",
		patientPlaceholder: "Selecione um paciente",
		patientNone: "Sem paciente",
		transcriptLabel: "Transcrição",
		transcriptPlaceholder: "Texto da transcrição (opcional)…",
		deleteFor: (label) => `Excluir ${label}`,
		deleteTitle: "Excluir consulta?",
		deleteDescription: (label) => `Isso exclui permanentemente ${label} e sua gravação.`,
		deleteConfirm: "Excluir permanentemente",
		cancel: "Cancelar",
	},
};

const es: ConsultationMessages = {
	sources: {
		browser: "Voz del navegador",
		bot: "Teleconsulta (bot)",
		dictation: "Dictado",
		upload: "Carga",
	},
	speakers: { doctor: "Médico", patient: "Paciente" },
	sections: {
		queixa_principal: "Motivo de consulta",
		hda: "Historia de la enfermedad actual",
		antecedentes: "Antecedentes patológicos",
		alergias: "Alergias",
		medicamentos_em_uso: "Medicamentos en uso",
		exame_fisico: "Examen físico",
		hipoteses: "Hipótesis diagnósticas",
		conduta: "Plan de manejo",
		historico: "Consultas anteriores",
	},
	confidence: { alta: "confianza alta", media: "confianza media", baixa: "confianza baja" },
	common: {
		consultations: "Consultas",
		anamnesis: "Anamnesis",
		transcript: "Transcripción",
		noTranscript: "Sin transcripción.",
		copy: "Copiar",
		downloadPdf: "Descargar PDF",
		engine: (engine) => `motor: ${engine}`,
		consultationId: (id) => `Consulta #${id}`,
	},
	list: {
		title: "Consultas",
		none: "Ninguna consulta aún.",
		count: (n) => `${n} consulta${n === 1 ? "" : "s"} registrada${n === 1 ? "" : "s"}.`,
		newConsultation: "+ Nueva consulta",
		searchPlaceholder: "Buscar por paciente, motivo o texto…",
		searchLabel: "Buscar consultas",
		filterLabel: "Filtrar consultas",
		filters: { all: "Todas", anamnesis: "Con anamnesis", pending: "Pendientes" },
		unlinkedPatient: "Paciente no vinculado",
		patientRecord: "Registro del paciente",
		live: "en vivo",
		noAnamnesis: "Sin anamnesis",
		consent: "Consentimiento ✓",
		downloadPdfTitle: "Descargar anamnesis en PDF",
		open: "Abrir",
		noMatch: "Ninguna consulta coincide con la búsqueda.",
		emptyTitle: "Ninguna consulta aún",
		emptyDescription: "Inicie una consulta para grabar la conversación y generar la anamnesis.",
		startConsultation: "Iniciar consulta",
	},
	detail: {
		back: "Consultas",
		openPatientRecord: "Abrir registro del paciente",
		consentRecorded: (date) => `Consentimiento ✓ ${date}`,
		consentNotRecorded: "Consentimiento no registrado",
		inProgress: "en curso",
		previousConsultations: (n) =>
			`${n} consulta${n === 1 ? "" : "s"} anterior${n === 1 ? "" : "es"}`,
		anamnesisCopied: "Anamnesis copiada",
		complaint: (text) => `Motivo: ${text}`,
		plan: (text) => `Plan: ${text}`,
		historyNote:
			"Registro factual de consultas anteriores — solo contexto, no sugerencias clínicas.",
		notReported: "No informado",
		evidence: (n) => `evidencias (${n})`,
		noAnamnesisTitle: "Ninguna anamnesis guardada",
		noAnamnesisDescription: "Esta consulta aún no tiene una anamnesis guardada.",
	},
	transcriptPanel: {
		sourceServer: "servidor · whisper large-v3-turbo",
		sourceBrowser: "navegador",
		sourceCorrected: "corregida por LLM",
		enhancementFailed: "falló la mejora — mostrando original",
		audioStored: "audio almacenado",
		enhancing: "mejorando transcripción…",
		enhanced: "mejorada ✓",
		audioLabel: "Audio de la consulta",
		tabCorrected: "Corregida",
		tabOriginal: "Original",
	},
	newConsultation: {
		title: "Nueva consulta",
		subtitle:
			"Grabe la conversación o pegue la transcripción. La anamnesis sale estructurada para revisión.",
		steps: { prepare: "Preparar", transcribe: "Transcribir", review: "Revisar" },
		modeLabel: "Modo de la consulta",
		modeLive: "Consulta en vivo",
		modeDictation: "Dictado posconsulta",
		patientLabel: "Paciente",
		unlinked: "no vinculado",
		newPatientPlaceholder: "nuevo paciente",
		newPatientNameLabel: "Nombre del nuevo paciente",
		agePlaceholder: "edad",
		newPatientAgeLabel: "Edad del nuevo paciente",
		ageRequired: "Ingrese la edad del paciente.",
		patientCreateFailed: "No se pudo registrar el paciente.",
		addPatient: "+ paciente",
		completeRecord: "Completar el registro",
		consentDeclaration: "Declaro que el paciente fue informado y consintió la grabación",
		tabRecord: "Grabar",
		tabUpload: "Carga",
		tabBot: "Teleconsulta (bot)",
		dictationDescription:
			"¿La consulta ya ocurrió? Narre todo en voz alta, como si explicara el caso, en una sola voz (la suya): motivo de consulta, historia, examen y plan. La narración se convierte en la transcripción que genera la anamnesis.",
		stopDictation: (elapsed) => `Detener dictado (${elapsed})`,
		startDictation: "Iniciar dictado",
		dictatingHint: (elapsed) =>
			`grabando… ${elapsed}. La transcripción aparece abajo en tiempo real`,
		consentRequiredDictation: "Marque la casilla de consentimiento arriba para activar el dictado.",
		consentRequiredRecording:
			"Marque la casilla de consentimiento arriba para activar la grabación.",
		unsupportedBrowser:
			"La grabación no es compatible con este navegador. Use el ejemplo o pegue el texto (Chrome/Edge lo admiten).",
		uploading: "Transcribiendo…",
		uploadRecording: "Enviar grabación",
		uploadHint: "Audio transcrito en el servidor (Whisper)",
		recordMic: "Grabar micrófono",
		stopMic: "Detener micrófono",
		micHint: (doctor) => `Su voz, mostrada como “${doctor}”`,
		captureTab: "Capturar pestaña de la llamada",
		stopTab: "Detener pestaña",
		tabHint: (patient) => `Audio de la llamada, mostrado como “${patient}”`,
		recordingTip:
			"Consejo: active ambos para separar médico y paciente, y use auriculares para que el micrófono no capte los altavoces.",
		channelsBadge: "voces separadas por canales",
		botDescription:
			"El bot “KTB Health” se une a su llamada (Meet/Zoom/Teams), transcribe con separación de voces y genera el borrador al final de la consulta.",
		teleconsultLinkLabel: "Enlace de teleconsulta",
		sendBot: "Enviar bot",
		botInCall: "bot en la llamada…",
		consultationLive: (id, status) => `consulta #${id} · ${status}`,
		transcribingLive: "transcribiendo en vivo",
		callEnded: "llamada finalizada",
		recordingSpeak: "grabando… hable con normalidad",
		consultationText: "Texto de la consulta",
		useSample: "Usar ejemplo",
		clear: "Limpiar",
		transcriptPlaceholder: "La transcripción aparece aquí (o pegue el texto de la consulta)",
		serverTranscript: "Transcripción del servidor",
		generating: "Generando anamnesis…",
		generate: "Generar anamnesis →",
		generatedFrom: (source) => `anamnesis generada a partir de la transcripción ${source}`,
		modelReady: (device) => `modelo listo${device ? ` (${device})` : ""}`,
		modelUnavailable: (message) => `modelo no disponible: ${message}`,
		lowConfidenceReprocessing: "confianza baja, reprocesando en el servidor…",
		transcriptionRedone: "transcripción rehecha en el servidor",
		engineLabel: (engine) => `motor: ${engine}`,
		waitingTitle: "Esperando anamnesis",
		waitingDescription:
			"La anamnesis estructurada aparece aquí. Cada sección muestra la confianza y las frases de origen que la respaldan.",
		saving: "Guardando…",
		saveConsultation: "Guardar consulta",
		updateConsultation: "Actualizar consulta",
		dialogErrorTitle: "No se pudo guardar",
		dialogUpdatedTitle: "Consulta actualizada",
		dialogSavedTitle: "Anamnesis guardada con éxito",
		viewConsultation: "Ver consulta",
		confirm: "Confirmar",
		gotIt: "Entendido",
		accessQuestion: (patient) => `¿Enviar a ${patient} el correo de acceso al portal del paciente?`,
		accessHint:
			"El paciente inicia sesión con este correo para ver, solo en lectura, las consultas que guardaste.",
		accessEmailPlaceholder: "paciente@correo.com",
		accessSend: "Enviar correo de acceso",
		accessNotNow: "Ahora no",
		accessSent: (email) => `Correo de acceso enviado a ${email}.`,
		accessUnsent: (email) =>
			`Acceso al portal concedido a ${email}, pero no se pudo enviar el correo. Pide al paciente que inicie sesión en el portal del paciente con esta dirección.`,
		accessInvalidEmail: "Ingresa un correo válido.",
		accessFailed: "No se pudo enviar el correo de acceso. Inténtalo de nuevo.",
		dialogSavedBody: ({ id, patientName, updated, consented }) =>
			`La consulta #${id}${patientName ? ` de ${patientName}` : ""} fue ${updated ? "actualizada" : "guardada"} con la anamnesis revisada.${consented ? " Consentimiento del paciente registrado." : ""}`,
		saveSessionExpired: "sesión expirada. Recargue la página",
		saveFailed: "no se pudo guardar la consulta",
		anamnesisCopied: "Anamnesis copiada al portapapeles",
		copyFailed: "No se pudo copiar. Seleccione el texto manualmente.",
		audioUploadFailed: (message) =>
			`No se pudo enviar el audio (${message}). La consulta se guardó sin él.`,
		transcriptionFailedStatus: (status) => `la transcripción falló (${status})`,
		transcriptionFailed: "falló la transcripción",
		botFailed: (status) => `el bot falló: HTTP ${status}`,
		patientFallback: "paciente",
	},
	admin: {
		title: "Consultas",
		none: "Ninguna consulta aún.",
		count: (n) => `${n} consulta${n === 1 ? "" : "s"} en toda la plataforma.`,
		emptyTitle: "Ninguna consulta",
		emptyDescription: "Las consultas aparecen aquí una vez creadas.",
		colId: "Id",
		colStatus: "Estado",
		colSource: "Origen",
		colPatient: "Paciente",
		colOwner: "Propietario",
		colAudio: "Audio",
		colCreated: "Creada",
		searchPlaceholder: "Buscar por paciente o propietario…",
		searchLabel: "Buscar consultas",
		noMatch: "Ninguna consulta coincide con la búsqueda.",
		filteredCount: (shown, total) => `Mostrando ${shown} de ${total}`,
		colActions: "Acciones",
		newConsultation: "Nueva consulta",
		createTitle: "Nueva consulta",
		createDescription: "Cree un registro de consulta en nombre de un propietario.",
		createFailed: "No se pudo crear la consulta. Inténtelo de nuevo.",
		ownerLabel: "Propietario",
		ownerPlaceholder: "Seleccione un propietario",
		patientLabel: "Paciente",
		patientPlaceholder: "Seleccione un paciente",
		patientNone: "Sin paciente",
		transcriptLabel: "Transcripción",
		transcriptPlaceholder: "Texto de la transcripción (opcional)…",
		deleteFor: (label) => `Eliminar ${label}`,
		deleteTitle: "¿Eliminar consulta?",
		deleteDescription: (label) => `Esto elimina permanentemente ${label} y su grabación.`,
		deleteConfirm: "Eliminar permanentemente",
		cancel: "Cancelar",
	},
};

const CATALOGS: Record<ConsultationLocale, ConsultationMessages> = { en, "pt-BR": ptBR, es };

export const isConsultationLocale = (locale: string): locale is ConsultationLocale =>
	(CONSULTATION_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const consultationMessages = (locale: string): ConsultationMessages =>
	CATALOGS[isConsultationLocale(locale) ? locale : BASE_LOCALE];

/** Localized capture-source label; unknown/absent sources pass through. */
export const sourceLabel = (t: ConsultationMessages, source: string | null | undefined): string =>
	source !== null && source !== undefined && source in t.sources
		? t.sources[source as keyof ConsultationMessages["sources"]]
		: (source ?? "");
