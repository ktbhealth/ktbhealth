/**
 * Jobs plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale (header-action prop / jobsFromAudioRows argument) and
 * the views resolve their strings here. A locale catalog must
 * implement `JobMessages` in full — a missing key is a type error,
 * not an English fallback at runtime.
 */

export const JOB_LOCALES = ["en", "pt-BR"] as const;
export type JobLocale = (typeof JOB_LOCALES)[number];
export const BASE_LOCALE: JobLocale = "en";

export interface JobMessages {
	readonly label: string;
	readonly activeCount: (n: number) => string;
	readonly emptyFilteredTitle: string;
	readonly emptyFilteredDescription: string;
	readonly emptyAllTitle: string;
	readonly emptyAllDescription: string;
	readonly openConsultations: string;
	/** Job row copy produced by jobsFromAudioRows/jobFromAudioRow. */
	readonly jobTitle: string;
	readonly consultationRef: (id: number) => string;
}

const en: JobMessages = {
	label: "Background jobs",
	activeCount: (n) => `${n} active`,
	emptyFilteredTitle: "No jobs in this state",
	emptyFilteredDescription: "Nothing matches the selected filter.",
	emptyAllTitle: "No background jobs",
	emptyAllDescription: "Transcription, export and sync jobs will appear here.",
	openConsultations: "Open consultations",
	jobTitle: "Audio transcription",
	consultationRef: (id) => `consultation #${id}`,
};

const ptBR: JobMessages = {
	label: "Tarefas em segundo plano",
	activeCount: (n) => `${n} ativas`,
	emptyFilteredTitle: "Nenhuma tarefa neste estado",
	emptyFilteredDescription: "Nada corresponde ao filtro selecionado.",
	emptyAllTitle: "Nenhuma tarefa em segundo plano",
	emptyAllDescription: "Tarefas de transcrição, exportação e sincronização aparecerão aqui.",
	openConsultations: "Abrir consultas",
	jobTitle: "Transcrição de áudio",
	consultationRef: (id) => `consulta #${id}`,
};

const CATALOGS: Record<JobLocale, JobMessages> = { en, "pt-BR": ptBR };

export const isJobLocale = (locale: string): locale is JobLocale =>
	(JOB_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const jobMessages = (locale: string): JobMessages =>
	CATALOGS[isJobLocale(locale) ? locale : BASE_LOCALE];
