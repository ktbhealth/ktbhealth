/**
 * Patients plugin copy, one typed catalog per locale. Plugins cannot
 * import the host's Paraglide output (arch lint), so the host passes the
 * active locale in and every view resolves its strings here. A locale
 * catalog must implement `PatientMessages` in full — a missing key is a
 * type error, not an English fallback at runtime.
 *
 * Pure module (no React): also used by record.ts for labels and errors.
 */
import type { Gender, Language, MaritalStatus, RaceColor } from "./record.ts";

/** Locales with a catalog; the host asserts it covers every app locale. */
export const PATIENT_LOCALES = ["en", "pt-BR", "es"] as const;
export type PatientLocale = (typeof PATIENT_LOCALES)[number];
export const BASE_LOCALE: PatientLocale = "en";

/** Validation outcome per field — codes on the wire, copy in the view. */
export type PatientErrorCode =
	| "too_long"
	| "name_required"
	| "birth_date_required"
	| "invalid_date"
	| "future_date"
	| "invalid_option"
	| "invalid_country"
	| "invalid_cpf"
	| "invalid_cns"
	| "invalid_email"
	| "invalid_phone"
	| "invalid_state"
	| "invalid_cep";

export interface PatientMessages {
	readonly gender: Record<Gender, string>;
	readonly maritalStatus: Record<MaritalStatus, string>;
	readonly raceColor: Record<RaceColor, string>;
	readonly language: Record<Language, string>;
	/** "42 years"; `approx` marks a year-only birth date ("~42 years"). */
	readonly age: (years: number, approx: boolean) => string;
	readonly errors: Record<Exclude<PatientErrorCode, "too_long">, string> & {
		readonly too_long: (max: number) => string;
	};
	readonly sections: {
		readonly identification: string;
		readonly identifiers: string;
		readonly contact: string;
		readonly address: string;
		readonly family: string;
		readonly emergency: string;
	};
	readonly fields: {
		readonly name: string;
		readonly socialName: string;
		readonly socialNameHint: string;
		readonly gender: string;
		readonly birthDate: string;
		readonly cpf: string;
		readonly cns: string;
		readonly cnsShort: string;
		readonly cnsPlaceholder: string;
		readonly passport: string;
		readonly phone: string;
		readonly email: string;
		readonly preferredLanguage: string;
		readonly country: string;
		readonly cep: string;
		readonly postalCode: string;
		readonly street: string;
		readonly number: string;
		readonly complement: string;
		readonly district: string;
		readonly city: string;
		readonly state: string;
		readonly stateProvince: string;
		readonly motherName: string;
		readonly maritalStatus: string;
		readonly raceColor: string;
		readonly raceColorShort: string;
		readonly nationality: string;
		readonly contactName: string;
		readonly relationship: string;
		readonly relationshipPlaceholder: string;
	};
	readonly common: {
		readonly patients: string;
		readonly inactive: string;
		readonly noDemographics: string;
		readonly registerPatient: string;
		readonly newPatient: string;
	};
	readonly list: {
		readonly none: string;
		readonly count: (n: number) => string;
		readonly searchPlaceholder: string;
		readonly searchLabel: string;
		readonly incomplete: string;
		readonly noMatch: string;
		readonly emptyTitle: string;
		readonly emptyDescription: string;
	};
	readonly detail: {
		readonly editRecord: string;
		readonly newConsultation: string;
		readonly incomplete: string;
		readonly completeRecord: string;
		readonly consultations: string;
		readonly live: string;
		readonly noAnamnesis: string;
		readonly noChiefComplaint: string;
		readonly noConsultations: string;
		readonly exportRecord: string;
		readonly exportHeading: string;
		readonly exportFhir: string;
		readonly exportOpenEhr: string;
	};
	readonly actions: {
		readonly menu: (name: string) => string;
		readonly edit: string;
		readonly delete: string;
	};
	readonly remove: {
		readonly title: string;
		readonly body: (name: string) => string;
		readonly checking: string;
		readonly noConsultations: string;
		/** Spells out the cascade: consultations, transcripts, anamneses, audio. */
		readonly withConsultations: (n: number) => string;
		readonly acknowledge: (n: number) => string;
		readonly confirm: string;
		readonly cancel: string;
		readonly failed: string;
	};
	readonly admin: {
		readonly title: string;
		readonly none: string;
		readonly count: (n: number) => string;
		readonly emptyTitle: string;
		readonly emptyDescription: string;
		readonly colId: string;
		readonly colName: string;
		readonly colOwner: string;
		readonly colOwnerId: string;
		readonly colCreated: string;
	};
	readonly form: {
		readonly editTitle: string;
		readonly intro: string;
		readonly or: string;
		readonly ageLabel: string;
		readonly agePlaceholder: string;
		readonly approximate: (date: string) => string;
		readonly pickDate: string;
		readonly activeRecord: string;
		readonly fixFields: string;
		readonly saveFailed: string;
		readonly saveFailedRetry: string;
		readonly cancel: string;
		readonly saveChanges: string;
	};
}

const en: PatientMessages = {
	gender: { female: "Female", male: "Male", other: "Other", unknown: "Unknown" },
	maritalStatus: {
		S: "Never married",
		M: "Married",
		T: "Domestic partner",
		L: "Legally separated",
		D: "Divorced",
		W: "Widowed",
		UNK: "Unknown",
	},
	raceColor: {
		"01": "Branca (white)",
		"02": "Preta (black)",
		"03": "Parda (mixed)",
		"04": "Amarela (East Asian)",
		"05": "Indígena (indigenous)",
		"99": "Not informed",
	},
	language: {
		"pt-BR": "Portuguese (Brazil)",
		en: "English",
		es: "Spanish",
		fr: "French",
		it: "Italian",
		de: "German",
	},
	age: (years, approx) => `${approx ? "~" : ""}${years} year${years === 1 ? "" : "s"}`,
	errors: {
		too_long: (max) => `Must be at most ${max} characters.`,
		name_required: "Name is required.",
		birth_date_required: "Birth date (or age) is required.",
		invalid_date: "Enter a valid date.",
		future_date: "Birth date cannot be in the future.",
		invalid_option: "Choose a valid option.",
		invalid_country: "Choose a valid country.",
		invalid_cpf: "Invalid CPF.",
		invalid_cns: "Invalid CNS.",
		invalid_email: "Invalid email.",
		invalid_phone: "Enter 8 to 15 digits.",
		invalid_state: "Choose a valid state.",
		invalid_cep: "CEP must have 8 digits.",
	},
	sections: {
		identification: "Identification",
		identifiers: "Identifiers",
		contact: "Contact",
		address: "Address",
		family: "Family and demographics",
		emergency: "Emergency contact",
	},
	fields: {
		name: "Full name",
		socialName: "Social name",
		socialNameHint: "Name the patient goes by; shown first when set.",
		gender: "Sex (administrative)",
		birthDate: "Birth date",
		cpf: "CPF",
		cns: "CNS (Cartão SUS)",
		cnsShort: "CNS",
		cnsPlaceholder: "15 digits",
		passport: "Passport / foreign ID",
		phone: "Phone",
		email: "Email",
		preferredLanguage: "Preferred language",
		country: "Country",
		cep: "CEP",
		postalCode: "Postal code",
		street: "Street",
		number: "Number",
		complement: "Complement",
		district: "District",
		city: "City",
		state: "State",
		stateProvince: "State / province",
		motherName: "Mother's name",
		maritalStatus: "Marital status",
		raceColor: "Race / color (IBGE)",
		raceColorShort: "Race / color",
		nationality: "Nationality",
		contactName: "Name",
		relationship: "Relationship",
		relationshipPlaceholder: "e.g. daughter",
	},
	common: {
		patients: "Patients",
		inactive: "Inactive",
		noDemographics: "No demographics recorded",
		registerPatient: "Register patient",
		newPatient: "New patient",
	},
	list: {
		none: "No patients yet.",
		count: (n) => `${n} patient${n === 1 ? "" : "s"} registered.`,
		searchPlaceholder: "Search by name, CPF, or CNS…",
		searchLabel: "Search patients",
		incomplete: "Incomplete record",
		noMatch: "No patients match the search.",
		emptyTitle: "No patients yet",
		emptyDescription: "Register a patient to link consultations and keep their history together.",
	},
	detail: {
		editRecord: "Edit record",
		newConsultation: "New consultation",
		incomplete: "This record is incomplete: birth date is missing.",
		completeRecord: "Complete the record",
		consultations: "Consultations",
		live: "live",
		noAnamnesis: "no anamnesis",
		noChiefComplaint: "No chief complaint recorded.",
		noConsultations: "No consultations for this patient yet.",
		exportRecord: "Export",
		exportHeading: "Record and consultations",
		exportFhir: "HL7 FHIR R4 (JSON)",
		exportOpenEhr: "openEHR (JSON)",
	},
	actions: {
		menu: (name) => `Actions for ${name}`,
		edit: "Edit record",
		delete: "Delete patient",
	},
	remove: {
		title: "Delete patient?",
		body: (name) => `This permanently deletes the record of ${name}.`,
		checking: "Checking linked consultations…",
		noConsultations: "This patient has no consultations. This action cannot be undone.",
		withConsultations: (n) =>
			`${n === 1 ? "1 consultation" : `${n} consultations`} of this patient will also be permanently deleted, including transcripts, anamneses and audio recordings. This action cannot be undone.`,
		acknowledge: (n) =>
			`I understand that ${n === 1 ? "1 consultation" : `${n} consultations`} will be deleted`,
		confirm: "Delete permanently",
		cancel: "Cancel",
		failed: "Could not delete the patient. Try again.",
	},
	admin: {
		title: "Patients",
		none: "No patients registered.",
		count: (n) => `${n} patient${n === 1 ? "" : "s"} across all owners.`,
		emptyTitle: "No patients",
		emptyDescription: "Patients appear here once created.",
		colId: "Id",
		colName: "Name",
		colOwner: "Owner",
		colOwnerId: "Owner id",
		colCreated: "Created",
	},
	form: {
		editTitle: "Edit patient",
		intro:
			"Record based on HL7 FHIR R4 Patient with the Brazilian RNDS extensions. Only name and birth date (or age) are required.",
		or: "or",
		ageLabel: "Age in years",
		agePlaceholder: "age",
		approximate: (date) => `Recorded as ${date} (approximate). Enter the exact date if known.`,
		pickDate: "Pick a date",
		activeRecord: "Active record",
		fixFields: "Please fix the highlighted fields.",
		saveFailed: "Could not save the patient.",
		saveFailedRetry: "Could not save the patient. Try again.",
		cancel: "Cancel",
		saveChanges: "Save changes",
	},
};

const ptBR: PatientMessages = {
	gender: { female: "Feminino", male: "Masculino", other: "Outro", unknown: "Desconhecido" },
	maritalStatus: {
		S: "Solteiro(a)",
		M: "Casado(a)",
		T: "União estável",
		L: "Separado(a) judicialmente",
		D: "Divorciado(a)",
		W: "Viúvo(a)",
		UNK: "Desconhecido",
	},
	raceColor: {
		"01": "Branca",
		"02": "Preta",
		"03": "Parda",
		"04": "Amarela",
		"05": "Indígena",
		"99": "Não informado",
	},
	language: {
		"pt-BR": "Português (Brasil)",
		en: "Inglês",
		es: "Espanhol",
		fr: "Francês",
		it: "Italiano",
		de: "Alemão",
	},
	age: (years, approx) => `${approx ? "~" : ""}${years} ano${years === 1 ? "" : "s"}`,
	errors: {
		too_long: (max) => `Use no máximo ${max} caracteres.`,
		name_required: "O nome é obrigatório.",
		birth_date_required: "A data de nascimento (ou idade) é obrigatória.",
		invalid_date: "Informe uma data válida.",
		future_date: "A data de nascimento não pode estar no futuro.",
		invalid_option: "Escolha uma opção válida.",
		invalid_country: "Escolha um país válido.",
		invalid_cpf: "CPF inválido.",
		invalid_cns: "CNS inválido.",
		invalid_email: "E-mail inválido.",
		invalid_phone: "Informe de 8 a 15 dígitos.",
		invalid_state: "Escolha um estado válido.",
		invalid_cep: "O CEP deve ter 8 dígitos.",
	},
	sections: {
		identification: "Identificação",
		identifiers: "Documentos",
		contact: "Contato",
		address: "Endereço",
		family: "Família e dados demográficos",
		emergency: "Contato de emergência",
	},
	fields: {
		name: "Nome completo",
		socialName: "Nome social",
		socialNameHint: "Nome pelo qual a pessoa é chamada; aparece primeiro quando preenchido.",
		gender: "Sexo (administrativo)",
		birthDate: "Data de nascimento",
		cpf: "CPF",
		cns: "CNS (Cartão SUS)",
		cnsShort: "CNS",
		cnsPlaceholder: "15 dígitos",
		passport: "Passaporte / documento estrangeiro",
		phone: "Telefone",
		email: "E-mail",
		preferredLanguage: "Idioma preferido",
		country: "País",
		cep: "CEP",
		postalCode: "Código postal",
		street: "Logradouro",
		number: "Número",
		complement: "Complemento",
		district: "Bairro",
		city: "Cidade",
		state: "Estado",
		stateProvince: "Estado / província",
		motherName: "Nome da mãe",
		maritalStatus: "Estado civil",
		raceColor: "Raça / cor (IBGE)",
		raceColorShort: "Raça / cor",
		nationality: "Nacionalidade",
		contactName: "Nome",
		relationship: "Parentesco",
		relationshipPlaceholder: "ex.: filha",
	},
	common: {
		patients: "Pacientes",
		inactive: "Inativo",
		noDemographics: "Sem dados demográficos registrados",
		registerPatient: "Cadastrar paciente",
		newPatient: "Novo paciente",
	},
	list: {
		none: "Nenhum paciente ainda.",
		count: (n) => `${n} paciente${n === 1 ? "" : "s"} cadastrado${n === 1 ? "" : "s"}.`,
		searchPlaceholder: "Buscar por nome, CPF ou CNS…",
		searchLabel: "Buscar pacientes",
		incomplete: "Cadastro incompleto",
		noMatch: "Nenhum paciente corresponde à busca.",
		emptyTitle: "Nenhum paciente ainda",
		emptyDescription: "Cadastre um paciente para vincular consultas e manter o histórico reunido.",
	},
	detail: {
		editRecord: "Editar cadastro",
		newConsultation: "Nova consulta",
		incomplete: "Este cadastro está incompleto: falta a data de nascimento.",
		completeRecord: "Completar o cadastro",
		consultations: "Consultas",
		live: "ao vivo",
		noAnamnesis: "sem anamnese",
		noChiefComplaint: "Nenhuma queixa principal registrada.",
		noConsultations: "Nenhuma consulta para este paciente ainda.",
		exportRecord: "Exportar",
		exportHeading: "Cadastro e consultas",
		exportFhir: "HL7 FHIR R4 (JSON)",
		exportOpenEhr: "openEHR (JSON)",
	},
	actions: {
		menu: (name) => `Ações para ${name}`,
		edit: "Editar cadastro",
		delete: "Excluir paciente",
	},
	remove: {
		title: "Excluir paciente?",
		body: (name) => `Isso exclui permanentemente o cadastro de ${name}.`,
		checking: "Verificando consultas vinculadas…",
		noConsultations: "Este paciente não tem consultas. Esta ação não pode ser desfeita.",
		withConsultations: (n) =>
			`${n === 1 ? "1 consulta" : `${n} consultas`} deste paciente também ${n === 1 ? "será excluída" : "serão excluídas"} permanentemente, incluindo transcrições, anamneses e gravações de áudio. Esta ação não pode ser desfeita.`,
		acknowledge: (n) =>
			`Entendo que ${n === 1 ? "1 consulta será excluída" : `${n} consultas serão excluídas`}`,
		confirm: "Excluir permanentemente",
		cancel: "Cancelar",
		failed: "Não foi possível excluir o paciente. Tente novamente.",
	},
	admin: {
		title: "Pacientes",
		none: "Nenhum paciente cadastrado.",
		count: (n) => `${n} paciente${n === 1 ? "" : "s"} em toda a plataforma.`,
		emptyTitle: "Nenhum paciente",
		emptyDescription: "Os pacientes aparecem aqui após serem cadastrados.",
		colId: "Id",
		colName: "Nome",
		colOwner: "Proprietário",
		colOwnerId: "Id do proprietário",
		colCreated: "Cadastrado em",
	},
	form: {
		editTitle: "Editar paciente",
		intro:
			"Cadastro baseado no recurso Patient do HL7 FHIR R4 com as extensões brasileiras da RNDS. Apenas nome e data de nascimento (ou idade) são obrigatórios.",
		or: "ou",
		ageLabel: "Idade em anos",
		agePlaceholder: "idade",
		approximate: (date) => `Registrado como ${date} (aproximado). Informe a data exata, se souber.`,
		pickDate: "Selecione uma data",
		activeRecord: "Cadastro ativo",
		fixFields: "Corrija os campos destacados.",
		saveFailed: "Não foi possível salvar o paciente.",
		saveFailedRetry: "Não foi possível salvar o paciente. Tente novamente.",
		cancel: "Cancelar",
		saveChanges: "Salvar alterações",
	},
};

const es: PatientMessages = {
	gender: { female: "Femenino", male: "Masculino", other: "Otro", unknown: "Desconocido" },
	maritalStatus: {
		S: "Soltero(a)",
		M: "Casado(a)",
		T: "Unión estable",
		L: "Separado(a) legalmente",
		D: "Divorciado(a)",
		W: "Viudo(a)",
		UNK: "Desconocido",
	},
	raceColor: {
		"01": "Blanca",
		"02": "Negra",
		"03": "Parda (mixta)",
		"04": "Amarilla (asiática oriental)",
		"05": "Indígena",
		"99": "No informado",
	},
	language: {
		"pt-BR": "Portugués (Brasil)",
		en: "Inglés",
		es: "Español",
		fr: "Francés",
		it: "Italiano",
		de: "Alemán",
	},
	age: (years, approx) => `${approx ? "~" : ""}${years} año${years === 1 ? "" : "s"}`,
	errors: {
		too_long: (max) => `Use como máximo ${max} caracteres.`,
		name_required: "El nombre es obligatorio.",
		birth_date_required: "La fecha de nacimiento (o edad) es obligatoria.",
		invalid_date: "Ingrese una fecha válida.",
		future_date: "La fecha de nacimiento no puede estar en el futuro.",
		invalid_option: "Elija una opción válida.",
		invalid_country: "Elija un país válido.",
		invalid_cpf: "CPF inválido.",
		invalid_cns: "CNS inválido.",
		invalid_email: "Correo electrónico inválido.",
		invalid_phone: "Ingrese de 8 a 15 dígitos.",
		invalid_state: "Elija un estado válido.",
		invalid_cep: "El CEP debe tener 8 dígitos.",
	},
	sections: {
		identification: "Identificación",
		identifiers: "Documentos",
		contact: "Contacto",
		address: "Dirección",
		family: "Familia y datos demográficos",
		emergency: "Contacto de emergencia",
	},
	fields: {
		name: "Nombre completo",
		socialName: "Nombre social",
		socialNameHint:
			"Nombre por el que se conoce a la persona; aparece primero cuando está informado.",
		gender: "Sexo (administrativo)",
		birthDate: "Fecha de nacimiento",
		cpf: "CPF",
		cns: "CNS (Cartão SUS)",
		cnsShort: "CNS",
		cnsPlaceholder: "15 dígitos",
		passport: "Pasaporte / documento extranjero",
		phone: "Teléfono",
		email: "Correo electrónico",
		preferredLanguage: "Idioma preferido",
		country: "País",
		cep: "CEP",
		postalCode: "Código postal",
		street: "Calle",
		number: "Número",
		complement: "Complemento",
		district: "Barrio",
		city: "Ciudad",
		state: "Estado",
		stateProvince: "Estado / provincia",
		motherName: "Nombre de la madre",
		maritalStatus: "Estado civil",
		raceColor: "Raza / color (IBGE)",
		raceColorShort: "Raza / color",
		nationality: "Nacionalidad",
		contactName: "Nombre",
		relationship: "Parentesco",
		relationshipPlaceholder: "ej.: hija",
	},
	common: {
		patients: "Pacientes",
		inactive: "Inactivo",
		noDemographics: "Sin datos demográficos registrados",
		registerPatient: "Registrar paciente",
		newPatient: "Nuevo paciente",
	},
	list: {
		none: "Ningún paciente aún.",
		count: (n) => `${n} paciente${n === 1 ? "" : "s"} registrado${n === 1 ? "" : "s"}.`,
		searchPlaceholder: "Buscar por nombre, CPF o CNS…",
		searchLabel: "Buscar pacientes",
		incomplete: "Registro incompleto",
		noMatch: "Ningún paciente coincide con la búsqueda.",
		emptyTitle: "Ningún paciente aún",
		emptyDescription:
			"Registre un paciente para vincular consultas y mantener el historial reunido.",
	},
	detail: {
		editRecord: "Editar registro",
		newConsultation: "Nueva consulta",
		incomplete: "Este registro está incompleto: falta la fecha de nacimiento.",
		completeRecord: "Completar el registro",
		consultations: "Consultas",
		live: "en vivo",
		noAnamnesis: "sin anamnesis",
		noChiefComplaint: "Ningún motivo de consulta registrado.",
		noConsultations: "Ninguna consulta para este paciente aún.",
		exportRecord: "Exportar",
		exportHeading: "Registro y consultas",
		exportFhir: "HL7 FHIR R4 (JSON)",
		exportOpenEhr: "openEHR (JSON)",
	},
	actions: {
		menu: (name) => `Acciones para ${name}`,
		edit: "Editar registro",
		delete: "Eliminar paciente",
	},
	remove: {
		title: "¿Eliminar paciente?",
		body: (name) => `Esto elimina permanentemente el registro de ${name}.`,
		checking: "Verificando consultas vinculadas…",
		noConsultations: "Este paciente no tiene consultas. Esta acción no se puede deshacer.",
		withConsultations: (n) =>
			`${n === 1 ? "1 consulta" : `${n} consultas`} de este paciente también ${n === 1 ? "será eliminada" : "serán eliminadas"} permanentemente, incluidas las transcripciones, anamnesis y grabaciones de audio. Esta acción no se puede deshacer.`,
		acknowledge: (n) =>
			`Entiendo que ${n === 1 ? "1 consulta será eliminada" : `${n} consultas serán eliminadas`}`,
		confirm: "Eliminar permanentemente",
		cancel: "Cancelar",
		failed: "No se pudo eliminar el paciente. Inténtelo de nuevo.",
	},
	admin: {
		title: "Pacientes",
		none: "Ningún paciente registrado.",
		count: (n) => `${n} paciente${n === 1 ? "" : "s"} en toda la plataforma.`,
		emptyTitle: "Ningún paciente",
		emptyDescription: "Los pacientes aparecen aquí una vez creados.",
		colId: "Id",
		colName: "Nombre",
		colOwner: "Propietario",
		colOwnerId: "Id del propietario",
		colCreated: "Creado",
	},
	form: {
		editTitle: "Editar paciente",
		intro:
			"Registro basado en el recurso Patient de HL7 FHIR R4 con las extensiones brasileñas de la RNDS. Solo el nombre y la fecha de nacimiento (o edad) son obligatorios.",
		or: "o",
		ageLabel: "Edad en años",
		agePlaceholder: "edad",
		approximate: (date) =>
			`Registrado como ${date} (aproximado). Ingrese la fecha exacta, si la conoce.`,
		pickDate: "Seleccione una fecha",
		activeRecord: "Registro activo",
		fixFields: "Corrija los campos resaltados.",
		saveFailed: "No se pudo guardar el paciente.",
		saveFailedRetry: "No se pudo guardar el paciente. Inténtelo de nuevo.",
		cancel: "Cancelar",
		saveChanges: "Guardar cambios",
	},
};

const CATALOGS: Record<PatientLocale, PatientMessages> = { en, "pt-BR": ptBR, es };

export const isPatientLocale = (locale: string): locale is PatientLocale =>
	(PATIENT_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const patientMessages = (locale: string): PatientMessages =>
	CATALOGS[isPatientLocale(locale) ? locale : BASE_LOCALE];
