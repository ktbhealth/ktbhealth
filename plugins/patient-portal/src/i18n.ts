/**
 * Patient-portal plugin copy, one typed catalog per locale. Plugins
 * cannot import the host's Paraglide output (arch lint), so the host
 * passes the active locale in and every view resolves its strings here.
 * A locale catalog must implement `PortalMessages` in full — a missing
 * key is a type error, not an English fallback at runtime.
 */
import type { AnamnesisSectionKey } from "@ktb/anamnesis/types";

/** Locales with a catalog; the host asserts it covers every app locale. */
export const PORTAL_LOCALES = ["en", "pt-BR", "es"] as const;
export type PortalLocale = (typeof PORTAL_LOCALES)[number];
export const BASE_LOCALE: PortalLocale = "en";

export interface PortalMessages {
	readonly title: string;
	/** Greeting — `name` is the signed-in user's name. */
	readonly greeting: (name: string) => string;
	readonly profilesTitle: string;
	readonly relation: { readonly self: string; readonly guardian: string };
	readonly current: string;
	readonly open: string;
	readonly chooseHint: string;
	readonly doctor: string;
	readonly patient: string;
	readonly consultationsTitle: string;
	/** List entry of a consultation with no chief complaint on record. */
	readonly consultationUntitled: string;
	readonly viewConsultation: string;
	readonly consultationsEmptyTitle: string;
	readonly consultationsEmptyDescription: string;
	/** Consultation page. */
	readonly consultationTitle: string;
	readonly back: string;
	readonly readOnlyNote: string;
	/** Shown when the doctor saved the record with every section blank. */
	readonly sectionsEmpty: string;
	readonly sections: Record<AnamnesisSectionKey, string>;
	readonly emptyTitle: string;
	readonly emptyDescription: string;
	/** Notice shown while invites wait on email verification. */
	readonly verifyEmailTitle: string;
	readonly verifyEmailDescription: string;
	readonly verifyEmailAction: string;
	readonly errors: Record<"failed", string>;
}

const en: PortalMessages = {
	title: "Patient portal",
	greeting: (name) => `Hello, ${name}.`,
	profilesTitle: "Profiles",
	relation: { self: "Me", guardian: "In my care" },
	current: "Open",
	open: "Open",
	chooseHint: "Choose a profile to see its consultations.",
	doctor: "Doctor",
	patient: "Patient",
	consultationsTitle: "Consultations",
	consultationUntitled: "Consultation",
	viewConsultation: "View consultation",
	consultationsEmptyTitle: "No consultations yet",
	consultationsEmptyDescription: "A consultation appears here once your doctor saves its record.",
	consultationTitle: "Consultation",
	back: "Back to my consultations",
	readOnlyNote: "This is the record your doctor saved. Only your doctor can change it.",
	sectionsEmpty: "Your doctor has not written anything in this record yet.",
	sections: {
		queixa_principal: "Chief complaint",
		hda: "History of present illness",
		antecedentes: "Past medical history",
		alergias: "Allergies",
		medicamentos_em_uso: "Current medications",
		exame_fisico: "Physical examination",
		hipoteses: "Diagnostic hypotheses",
		conduta: "Management plan",
	},
	emptyTitle: "No records linked yet",
	emptyDescription: "When a doctor invites this email, your consultations appear here.",
	verifyEmailTitle: "Confirm your email",
	verifyEmailDescription:
		"A doctor invited this address — the consultations shared with you unlock once your email is confirmed.",
	verifyEmailAction: "Resend verification link",
	errors: {
		failed: "Something went wrong. Please try again.",
	},
};

const ptBR: PortalMessages = {
	title: "Portal do paciente",
	greeting: (name) => `Olá, ${name}.`,
	profilesTitle: "Perfis",
	relation: { self: "Eu", guardian: "Sob meus cuidados" },
	current: "Aberto",
	open: "Abrir",
	chooseHint: "Escolha um perfil para ver as consultas.",
	doctor: "Médico",
	patient: "Paciente",
	consultationsTitle: "Consultas",
	consultationUntitled: "Consulta",
	viewConsultation: "Ver consulta",
	consultationsEmptyTitle: "Nenhuma consulta ainda",
	consultationsEmptyDescription:
		"Uma consulta aparece aqui assim que seu médico salvar o registro dela.",
	consultationTitle: "Consulta",
	back: "Voltar às minhas consultas",
	readOnlyNote: "Este é o registro que seu médico salvou. Somente seu médico pode alterá-lo.",
	sectionsEmpty: "Seu médico ainda não escreveu nada neste registro.",
	sections: {
		queixa_principal: "Queixa principal",
		hda: "História da doença atual",
		antecedentes: "Antecedentes patológicos",
		alergias: "Alergias",
		medicamentos_em_uso: "Medicamentos em uso",
		exame_fisico: "Exame físico",
		hipoteses: "Hipóteses diagnósticas",
		conduta: "Conduta",
	},
	emptyTitle: "Nenhuma ficha vinculada ainda",
	emptyDescription: "Quando um médico convidar este e-mail, suas consultas aparecem aqui.",
	verifyEmailTitle: "Confirme seu e-mail",
	verifyEmailDescription:
		"Um médico convidou este endereço — as consultas compartilhadas com você são liberadas assim que o e-mail for confirmado.",
	verifyEmailAction: "Reenviar link de verificação",
	errors: {
		failed: "Algo deu errado. Tente novamente.",
	},
};

const es: PortalMessages = {
	title: "Portal del paciente",
	greeting: (name) => `Hola, ${name}.`,
	profilesTitle: "Perfiles",
	relation: { self: "Yo", guardian: "A mi cuidado" },
	current: "Abierto",
	open: "Abrir",
	chooseHint: "Elige un perfil para ver sus consultas.",
	doctor: "Médico",
	patient: "Paciente",
	consultationsTitle: "Consultas",
	consultationUntitled: "Consulta",
	viewConsultation: "Ver consulta",
	consultationsEmptyTitle: "Aún no hay consultas",
	consultationsEmptyDescription:
		"Una consulta aparece aquí en cuanto tu médico guarda su registro.",
	consultationTitle: "Consulta",
	back: "Volver a mis consultas",
	readOnlyNote: "Este es el registro que guardó tu médico. Solo tu médico puede cambiarlo.",
	sectionsEmpty: "Tu médico aún no ha escrito nada en este registro.",
	sections: {
		queixa_principal: "Motivo de consulta",
		hda: "Historia de la enfermedad actual",
		antecedentes: "Antecedentes patológicos",
		alergias: "Alergias",
		medicamentos_em_uso: "Medicamentos en uso",
		exame_fisico: "Examen físico",
		hipoteses: "Hipótesis diagnósticas",
		conduta: "Plan de manejo",
	},
	emptyTitle: "Aún no hay fichas vinculadas",
	emptyDescription: "Cuando un médico invite este correo, tus consultas aparecerán aquí.",
	verifyEmailTitle: "Confirma tu correo",
	verifyEmailDescription:
		"Un médico invitó esta dirección — las consultas compartidas contigo se desbloquean cuando confirmes el correo.",
	verifyEmailAction: "Reenviar enlace de verificación",
	errors: {
		failed: "Algo salió mal. Inténtalo de nuevo.",
	},
};

const CATALOGS: Record<PortalLocale, PortalMessages> = { en, "pt-BR": ptBR, es };

export const isPortalLocale = (locale: string): locale is PortalLocale =>
	(PORTAL_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const portalMessages = (locale: string): PortalMessages =>
	CATALOGS[isPortalLocale(locale) ? locale : BASE_LOCALE];
