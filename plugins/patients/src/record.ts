/**
 * Patient record vocabulary — HL7 FHIR R4 `Patient` as the base, plus the
 * Brazilian extensions profiled by RNDS / BR Core (CPF, CNS, social name,
 * mother's name, race/color, nationality). Stored codes are the standard
 * ones, so a FHIR export is a mapping, not a translation.
 *
 * Pure module (no db, no React): shared by the service, the server fns
 * (wire validation) and the form (inline errors).
 */

/** FHIR AdministrativeGender. */
export const GENDERS = ["female", "male", "other", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
	female: "Female",
	male: "Male",
	other: "Other",
	unknown: "Unknown",
};

/** HL7 v3 MaritalStatus (FHIR Patient.maritalStatus). */
export const MARITAL_STATUSES = ["S", "M", "T", "L", "D", "W", "U"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
	S: "Never married",
	M: "Married",
	T: "Domestic partner",
	L: "Legally separated",
	D: "Divorced",
	W: "Widowed",
	U: "Unknown",
};

/** RNDS BRRacaCor — IBGE race/color categories. */
export const RACE_COLORS = ["01", "02", "03", "04", "05", "99"] as const;
export type RaceColor = (typeof RACE_COLORS)[number];
export const RACE_COLOR_LABELS: Record<RaceColor, string> = {
	"01": "Branca (white)",
	"02": "Preta (black)",
	"03": "Parda (mixed)",
	"04": "Amarela (East Asian)",
	"05": "Indígena (indigenous)",
	"99": "Not informed",
};

/** BCP-47 tags offered for Patient.communication.language. */
export const LANGUAGES = ["pt-BR", "en", "es", "fr", "it", "de"] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_LABELS: Record<Language, string> = {
	"pt-BR": "Portuguese (Brazil)",
	en: "English",
	es: "Spanish",
	fr: "French",
	it: "Italian",
	de: "German",
};

/** Brazilian federative units (address.state when country is BR). */
export const BR_STATES = [
	"AC",
	"AL",
	"AP",
	"AM",
	"BA",
	"CE",
	"DF",
	"ES",
	"GO",
	"MA",
	"MT",
	"MS",
	"MG",
	"PA",
	"PB",
	"PR",
	"PE",
	"PI",
	"RJ",
	"RN",
	"RS",
	"RO",
	"RR",
	"SC",
	"SP",
	"SE",
	"TO",
] as const;

/** ISO 3166-1 alpha-2 (address.country, nationality). */
export const COUNTRIES = (
	"AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ " +
	"BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM " +
	"DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS " +
	"GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
	"KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ " +
	"MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
	"PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV " +
	"SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
	"VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/** English display name for an ISO 3166-1 alpha-2 code. */
export const countryName = (code: string): string => String(REGION_NAMES.of(code));

// ---------- record shape ----------

/** Free-text/coded fields of the record, in form order. */
export const TEXT_FIELDS = [
	"name",
	"socialName",
	"gender",
	"birthDate",
	"cpf",
	"cns",
	"passport",
	"phone",
	"email",
	"preferredLanguage",
	"addressLine",
	"addressNumber",
	"addressComplement",
	"district",
	"city",
	"state",
	"postalCode",
	"country",
	"motherName",
	"maritalStatus",
	"raceColor",
	"nationality",
	"emergencyContactName",
	"emergencyContactRelationship",
	"emergencyContactPhone",
] as const;
export type TextField = (typeof TEXT_FIELDS)[number];

/** Form / wire shape: every field optional text; `active` defaults to true. */
export type PatientDraft = { readonly [K in TextField]?: string | null } & {
	readonly active?: boolean;
};

/** Normalized column values — what the repo persists. */
export type PatientFields = { [K in TextField]: string | null } & {
	name: string;
	birthDate: string;
	active: boolean;
};

export type PatientErrors = Partial<Record<TextField, string>>;

export type ValidationResult =
	| { readonly ok: true; readonly fields: PatientFields }
	| { readonly ok: false; readonly errors: PatientErrors };

// ---------- identifiers ----------

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** CPF (Cadastro de Pessoas Físicas) — 11 digits, two mod-11 check digits. */
export function isValidCpf(value: string): boolean {
	const d = digitsOf(value);
	if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
	const check = (len: number) => {
		let sum = 0;
		for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
		return ((sum * 10) % 11) % 10;
	};
	return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/**
 * CNS (Cartão Nacional de Saúde) — 15 digits starting with 1/2
 * (definitive) or 7/8/9 (provisional); the weighted sum (15..1) is a
 * multiple of 11 for both kinds.
 */
export function isValidCns(value: string): boolean {
	const d = digitsOf(value);
	if (!/^[12789]\d{14}$/.test(d)) return false;
	let sum = 0;
	for (let i = 0; i < 15; i++) sum += Number(d[i]) * (15 - i);
	return sum % 11 === 0;
}

export const formatCpf = (cpf: string) =>
	cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export const formatCns = (cns: string) =>
	cns.replace(/^(\d{3})(\d{4})(\d{4})(\d{4})$/, "$1 $2 $3 $4");

export const formatPostalCode = (code: string, country: string | null) =>
	country === "BR" ? code.replace(/^(\d{5})(\d{3})$/, "$1-$2") : code;

// ---------- dates ----------

const FHIR_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

interface DateParts {
	readonly year: number;
	readonly month?: number;
	readonly day?: number;
}

/** FHIR `date` (YYYY | YYYY-MM | YYYY-MM-DD) → parts; null when malformed or impossible. */
export function parseFhirDate(value: string): DateParts | null {
	const m = FHIR_DATE.exec(value);
	if (!m) return null;
	const year = Number(m[1]);
	if (m[2] === undefined) return { year };
	const month = Number(m[2]);
	if (month < 1 || month > 12) return null;
	if (m[3] === undefined) return { year, month };
	const day = Number(m[3]);
	const probe = new Date(Date.UTC(year, month - 1, day));
	if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
	return { year, month, day };
}

/**
 * Whole years from a FHIR birth date to `now`. Partial dates are
 * approximate by nature: year-only counts calendar years, year-month
 * ignores the day.
 */
export function ageFromBirthDate(birthDate: string, now: Date = new Date()): number | null {
	const p = parseFhirDate(birthDate);
	if (!p) return null;
	const month = now.getMonth() + 1;
	let age = now.getFullYear() - p.year;
	if (p.month !== undefined) {
		const notYet =
			month < p.month || (month === p.month && p.day !== undefined && now.getDate() < p.day);
		if (notYet) age -= 1;
	}
	return age;
}

/** Quick registration by age: FHIR allows a year-only birth date. */
export const birthDateFromAge = (age: number, now: Date = new Date()) =>
	String(now.getFullYear() - age);

/** "42 years", "~42 years" for a year-only birth date; null when unknown. */
export function ageLabel(birthDate: string | null, now?: Date): string | null {
	if (!birthDate) return null;
	const age = ageFromBirthDate(birthDate, now);
	if (age === null) return null;
	const approx = birthDate.length === 4 ? "~" : "";
	return `${approx}${age} year${age === 1 ? "" : "s"}`;
}

interface Demographic {
	readonly gender: string | null;
	readonly birthDate: string | null;
}

/** "Female · 42 years" — whatever of sex/age is recorded. */
export function demographics(p: Demographic, now?: Date): string {
	const sex = p.gender ? GENDER_LABELS[p.gender as Gender] : null;
	return [sex, ageLabel(p.birthDate, now)].filter(Boolean).join(" · ");
}

/** One-line record summary for documents (PDF header); null when nothing is recorded. */
export function recordSummary(p: Demographic & { readonly cpf: string | null }, now?: Date) {
	return (
		[demographics(p, now), p.cpf ? `CPF ${formatCpf(p.cpf)}` : null].filter(Boolean).join(" · ") ||
		null
	);
}

/** Sex/age for the anamnesis drafter (only the keys that are known). */
export function demographicContext(p: Demographic, now?: Date): { sex?: string; age?: number } {
	const age = p.birthDate ? ageFromBirthDate(p.birthDate, now) : null;
	return {
		...(p.gender ? { sex: p.gender } : {}),
		...(age !== null ? { age } : {}),
	};
}

/** FHIR date → dd/mm/yyyy (or mm/yyyy, yyyy for partial dates). */
export function formatBirthDate(birthDate: string): string {
	const [y, m, d] = birthDate.split("-");
	return [d, m, y].filter(Boolean).join("/");
}

// ---------- validation ----------

const MAX_TEXT = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isOneOf = <T extends string>(list: readonly T[], v: string): v is T =>
	(list as readonly string[]).includes(v);
const phoneDigitsOk = (v: string) => {
	const n = digitsOf(v).length;
	return n >= 8 && n <= 15;
};

/**
 * Normalize and validate a draft. Text is trimmed and blanks become null;
 * identifiers and postal codes keep digits only; country codes are
 * upper-cased. Name and birth date are required.
 */
export function validatePatient(draft: PatientDraft, now: Date = new Date()): ValidationResult {
	const errors: PatientErrors = {};
	const v = {} as Record<TextField, string | null>;
	for (const key of TEXT_FIELDS) {
		const raw = draft[key];
		const text = typeof raw === "string" ? raw.trim() : "";
		v[key] = text === "" ? null : text;
		if (text.length > MAX_TEXT) errors[key] = `Must be at most ${MAX_TEXT} characters.`;
	}

	if (v.name === null) errors.name = "Name is required.";

	if (v.birthDate === null) {
		errors.birthDate = "Birth date (or age) is required.";
	} else {
		const p = parseFhirDate(v.birthDate);
		const age = ageFromBirthDate(v.birthDate, now);
		if (!p || p.year < 1900) errors.birthDate = "Enter a valid date.";
		else if (age === null || age < 0) errors.birthDate = "Birth date cannot be in the future.";
	}

	if (v.gender !== null && !isOneOf(GENDERS, v.gender)) errors.gender = "Choose a valid option.";
	if (v.maritalStatus !== null && !isOneOf(MARITAL_STATUSES, v.maritalStatus))
		errors.maritalStatus = "Choose a valid option.";
	if (v.raceColor !== null && !isOneOf(RACE_COLORS, v.raceColor))
		errors.raceColor = "Choose a valid option.";
	if (v.preferredLanguage !== null && !isOneOf(LANGUAGES, v.preferredLanguage))
		errors.preferredLanguage = "Choose a valid option.";

	for (const key of ["country", "nationality"] as const) {
		const code = v[key]?.toUpperCase() ?? null;
		v[key] = code;
		if (code !== null && !COUNTRIES.includes(code)) errors[key] = "Choose a valid country.";
	}

	if (v.cpf !== null) {
		if (isValidCpf(v.cpf)) v.cpf = digitsOf(v.cpf);
		else errors.cpf = "Invalid CPF.";
	}
	if (v.cns !== null) {
		if (isValidCns(v.cns)) v.cns = digitsOf(v.cns);
		else errors.cns = "Invalid CNS.";
	}

	if (v.email !== null && !EMAIL.test(v.email)) errors.email = "Invalid email.";
	for (const key of ["phone", "emergencyContactPhone"] as const) {
		const phone = v[key];
		if (phone !== null && !phoneDigitsOk(phone)) errors[key] = "Enter 8 to 15 digits.";
	}

	if (v.country === "BR") {
		if (v.state !== null && !isOneOf(BR_STATES, v.state.toUpperCase()))
			errors.state = "Choose a valid state.";
		else if (v.state !== null) v.state = v.state.toUpperCase();
		if (v.postalCode !== null) {
			const cep = digitsOf(v.postalCode);
			if (cep.length === 8) v.postalCode = cep;
			else errors.postalCode = "CEP must have 8 digits.";
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return {
		ok: true,
		fields: {
			...v,
			name: v.name as string,
			birthDate: v.birthDate as string,
			active: draft.active ?? true,
		},
	};
}
