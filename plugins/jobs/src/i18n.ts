/**
 * Jobs plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint); the host injects the
 * active locale (header-action prop / jobsFromAudioRows argument) and
 * the views resolve their strings here. A locale catalog must
 * implement `JobMessages` in full — a missing key is a type error,
 * not an English fallback at runtime.
 */

export const JOB_LOCALES = ["en", "pt-BR", "es"] as const;
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

const es: JobMessages = {
	label: "Tareas en segundo plano",
	activeCount: (n) => `${n} activas`,
	emptyFilteredTitle: "Ninguna tarea en este estado",
	emptyFilteredDescription: "Nada coincide con el filtro seleccionado.",
	emptyAllTitle: "Ninguna tarea en segundo plano",
	emptyAllDescription: "Las tareas de transcripción, exportación y sincronización aparecerán aquí.",
	openConsultations: "Abrir consultas",
	jobTitle: "Transcripción de audio",
	consultationRef: (id) => `consulta #${id}`,
};

const CATALOGS: Record<JobLocale, JobMessages> = { en, "pt-BR": ptBR, es };

export const isJobLocale = (locale: string): locale is JobLocale =>
	(JOB_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const jobMessages = (locale: string): JobMessages =>
	CATALOGS[isJobLocale(locale) ? locale : BASE_LOCALE];

/* ------------------------- /platform/ops console ------------------------ */

/** Copy for the ops console page (T-035) — same catalog rules as
 * {@link JobMessages}: every locale implements the interface in full. */
export interface OpsMessages {
	readonly title: string;
	readonly description: (n: number) => string;
	readonly jobsTitle: string;
	readonly jobsDescription: string;
	readonly colConsultation: string;
	readonly colPatient: string;
	readonly colStatus: string;
	readonly colError: string;
	readonly colCreated: string;
	readonly colActions: string;
	readonly noPatient: string;
	readonly emptyJobsTitle: string;
	readonly emptyJobsDescription: string;
	readonly unavailableTitle: string;
	readonly unavailableDescription: string;
	readonly searchPlaceholder: string;
	readonly searchLabel: string;
	readonly noMatch: string;
	readonly statusStored: string;
	readonly statusQueued: string;
	readonly statusProcessing: string;
	readonly statusDone: string;
	readonly statusFailed: string;
	readonly retry: string;
	readonly retryTitle: string;
	readonly retryDescription: (ref: string) => string;
	readonly retryConfirm: string;
	readonly cancel: string;
	readonly retryError: string;
	readonly queueTitle: string;
	readonly queueDescription: string;
	readonly queuePending: string;
	readonly queueProcessing: string;
	readonly queueDone: string;
	readonly queueFailed: string;
	readonly storageTitle: string;
	readonly storageDescription: string;
	readonly storageObjects: (n: number) => string;
	readonly storageTruncated: string;
	readonly webhooksTitle: string;
	readonly webhooksDescription: string;
	readonly webhooksUnavailable: string;
}

const opsEn: OpsMessages = {
	title: "Ops",
	description: (n) => `${n} audio pipeline ${n === 1 ? "job" : "jobs"} tracked.`,
	jobsTitle: "Audio pipeline jobs",
	jobsDescription: "Consultation transcription jobs across all owners.",
	colConsultation: "Consultation",
	colPatient: "Patient",
	colStatus: "Status",
	colError: "Error",
	colCreated: "Created",
	colActions: "Actions",
	noPatient: "—",
	emptyJobsTitle: "No audio jobs",
	emptyJobsDescription: "Consultations with audio recordings will appear here.",
	unavailableTitle: "Signal unavailable",
	unavailableDescription: "This signal cannot be read in the current environment.",
	searchPlaceholder: "Filter jobs…",
	searchLabel: "Filter jobs",
	noMatch: "No jobs match the filter.",
	statusStored: "Stored",
	statusQueued: "Queued",
	statusProcessing: "Processing",
	statusDone: "Done",
	statusFailed: "Failed",
	retry: "Retry",
	retryTitle: "Retry transcription?",
	retryDescription: (ref) =>
		`Re-enqueue the transcription job for ${ref}. The stored recording is transcribed again.`,
	retryConfirm: "Retry job",
	cancel: "Cancel",
	retryError: "Retry failed — the job could not be re-enqueued.",
	queueTitle: "Transcription queue",
	queueDescription: "Pending and in-flight deliveries in the job queue.",
	queuePending: "Pending",
	queueProcessing: "Processing",
	queueDone: "Done",
	queueFailed: "Failed",
	storageTitle: "Audio storage",
	storageDescription: "Objects in the consultation audio bucket.",
	storageObjects: (n) => `${n} ${n === 1 ? "object" : "objects"}`,
	storageTruncated: "Listing capped — counts are a lower bound.",
	webhooksTitle: "Bot webhooks",
	webhooksDescription: "Recent transcript deliveries from the meeting bot.",
	webhooksUnavailable:
		"Delivery logging is not instrumented yet — the bot webhook does not record deliveries, so there is nothing to show.",
};

const opsPtBR: OpsMessages = {
	title: "Operações",
	description: (n) => `${n} ${n === 1 ? "tarefa" : "tarefas"} do pipeline de áudio monitoradas.`,
	jobsTitle: "Tarefas do pipeline de áudio",
	jobsDescription: "Tarefas de transcrição de consultas de todos os proprietários.",
	colConsultation: "Consulta",
	colPatient: "Paciente",
	colStatus: "Status",
	colError: "Erro",
	colCreated: "Criada em",
	colActions: "Ações",
	noPatient: "—",
	emptyJobsTitle: "Nenhuma tarefa de áudio",
	emptyJobsDescription: "Consultas com gravações de áudio aparecerão aqui.",
	unavailableTitle: "Sinal indisponível",
	unavailableDescription: "Este sinal não pode ser lido no ambiente atual.",
	searchPlaceholder: "Filtrar tarefas…",
	searchLabel: "Filtrar tarefas",
	noMatch: "Nenhuma tarefa corresponde ao filtro.",
	statusStored: "Armazenado",
	statusQueued: "Na fila",
	statusProcessing: "Processando",
	statusDone: "Concluído",
	statusFailed: "Falhou",
	retry: "Tentar novamente",
	retryTitle: "Tentar transcrição novamente?",
	retryDescription: (ref) =>
		`Reenfileirar a tarefa de transcrição de ${ref}. A gravação armazenada será transcrita novamente.`,
	retryConfirm: "Tentar tarefa",
	cancel: "Cancelar",
	retryError: "Falha ao tentar novamente — a tarefa não pôde ser reenfileirada.",
	queueTitle: "Fila de transcrição",
	queueDescription: "Entregas pendentes e em andamento na fila de tarefas.",
	queuePending: "Pendentes",
	queueProcessing: "Processando",
	queueDone: "Concluídas",
	queueFailed: "Falhas",
	storageTitle: "Armazenamento de áudio",
	storageDescription: "Objetos no bucket de áudio das consultas.",
	storageObjects: (n) => `${n} ${n === 1 ? "objeto" : "objetos"}`,
	storageTruncated: "Listagem limitada — as contagens são um limite inferior.",
	webhooksTitle: "Webhooks do bot",
	webhooksDescription: "Entregas recentes de transcrição do bot de reunião.",
	webhooksUnavailable:
		"O registro de entregas ainda não está instrumentado — o webhook do bot não grava entregas, então não há nada para mostrar.",
};

const opsEs: OpsMessages = {
	title: "Operaciones",
	description: (n) => `${n} ${n === 1 ? "tarea" : "tareas"} del pipeline de audio monitorizadas.`,
	jobsTitle: "Tareas del pipeline de audio",
	jobsDescription: "Tareas de transcripción de consultas de todos los propietarios.",
	colConsultation: "Consulta",
	colPatient: "Paciente",
	colStatus: "Estado",
	colError: "Error",
	colCreated: "Creada",
	colActions: "Acciones",
	noPatient: "—",
	emptyJobsTitle: "Sin tareas de audio",
	emptyJobsDescription: "Las consultas con grabaciones de audio aparecerán aquí.",
	unavailableTitle: "Señal no disponible",
	unavailableDescription: "Esta señal no se puede leer en el entorno actual.",
	searchPlaceholder: "Filtrar tareas…",
	searchLabel: "Filtrar tareas",
	noMatch: "Ninguna tarea coincide con el filtro.",
	statusStored: "Almacenado",
	statusQueued: "En cola",
	statusProcessing: "Procesando",
	statusDone: "Completado",
	statusFailed: "Falló",
	retry: "Reintentar",
	retryTitle: "¿Reintentar la transcripción?",
	retryDescription: (ref) =>
		`Volver a encolar la tarea de transcripción de ${ref}. La grabación almacenada se transcribirá de nuevo.`,
	retryConfirm: "Reintentar tarea",
	cancel: "Cancelar",
	retryError: "Error al reintentar — la tarea no se pudo encolar de nuevo.",
	queueTitle: "Cola de transcripción",
	queueDescription: "Entregas pendientes y en curso en la cola de tareas.",
	queuePending: "Pendientes",
	queueProcessing: "Procesando",
	queueDone: "Completadas",
	queueFailed: "Fallidas",
	storageTitle: "Almacenamiento de audio",
	storageDescription: "Objetos en el bucket de audio de las consultas.",
	storageObjects: (n) => `${n} ${n === 1 ? "objeto" : "objetos"}`,
	storageTruncated: "Listado limitado — los recuentos son un límite inferior.",
	webhooksTitle: "Webhooks del bot",
	webhooksDescription: "Entregas recientes de transcripción del bot de reunión.",
	webhooksUnavailable:
		"El registro de entregas aún no está instrumentado — el webhook del bot no guarda entregas, así que no hay nada que mostrar.",
};

const OPS_CATALOGS: Record<JobLocale, OpsMessages> = { en: opsEn, "pt-BR": opsPtBR, es: opsEs };

/** Catalog for a locale tag; unknown tags get the base locale. */
export const opsMessages = (locale: string): OpsMessages =>
	OPS_CATALOGS[isJobLocale(locale) ? locale : BASE_LOCALE];
