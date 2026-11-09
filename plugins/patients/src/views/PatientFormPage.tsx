import { Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import { AsteriskIcon, CalendarIcon } from "lucide-react";
import type { Locale as CalendarLocale } from "react-day-picker";
import { enUS, ptBR } from "react-day-picker/locale";

import { Alert } from "@ktbhealth/ui/components/alert";
import { Button } from "@ktbhealth/ui/components/button";
import { Calendar } from "@ktbhealth/ui/components/calendar";
import { Checkbox } from "@ktbhealth/ui/components/checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@ktbhealth/ui/components/field";
import { Input } from "@ktbhealth/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ktbhealth/ui/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import type { Patient } from "../index.ts";
import { patientMessages, type PatientLocale } from "../i18n.ts";
import {
	ageFromBirthDate,
	birthDateFromAge,
	BR_STATES,
	COUNTRIES,
	countryName,
	errorMessage,
	formatBirthDate,
	GENDERS,
	LANGUAGES,
	MARITAL_STATUSES,
	RACE_COLORS,
	TEXT_FIELDS,
	validatePatient,
	type PatientDraft,
	type PatientErrors,
	type TextField,
} from "../record.ts";

export type SavePatientResult =
	| { readonly ok: true; readonly patient: { readonly id: number } }
	| { readonly ok: false; readonly errors: PatientErrors };

/** Host-injected persistence (create or update, chosen by the route). */
export interface PatientFormApi {
	save(draft: PatientDraft): Promise<SavePatientResult>;
}

type FormState = Record<TextField, string> & { active: boolean };

const NEW_DEFAULTS: Partial<Record<TextField, string>> = {
	country: "BR",
	nationality: "BR",
	preferredLanguage: "pt-BR",
};

function initialState(patient: Patient | undefined): FormState {
	const state = { active: patient?.active ?? true } as FormState;
	for (const key of TEXT_FIELDS) {
		state[key] = patient ? (patient[key] ?? "") : (NEW_DEFAULTS[key] ?? "");
	}
	return state;
}

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Countries by localized name, in the locale's collation order. */
const countryOptions = (locale: string) =>
	COUNTRIES.map((c) => [c, countryName(c, locale)] as const).sort((a, b) =>
		a[1].localeCompare(b[1], locale),
	);

export function PatientFormPage({
	patient,
	api,
	onSaved,
	locale,
}: {
	/** Absent → registration; present → edit. */
	patient?: Patient;
	api: PatientFormApi;
	onSaved: (id: number) => void;
	/** Active UI locale, injected by the host. */
	locale: string;
}) {
	const t = patientMessages(locale);
	const f = t.fields;
	const countries = useMemo(() => countryOptions(locale), [locale]);
	const [form, setForm] = useState(() => initialState(patient));
	const [ageText, setAgeText] = useState(() =>
		form.birthDate.length === 4 ? String(ageFromBirthDate(form.birthDate)) : "",
	);
	const [errors, setErrors] = useState<PatientErrors>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const set = (key: TextField) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
	const errorFor = (key: TextField) => {
		const code = errors[key];
		return code ? errorMessage(code, locale) : undefined;
	};

	const text = (key: TextField, label: string, extra: Partial<TextInputProps> = {}) => (
		<TextInput
			id={key}
			label={label}
			value={form[key]}
			onChange={set(key)}
			error={errorFor(key)}
			{...extra}
		/>
	);

	const select = (
		key: TextField,
		label: string,
		options: ReadonlyArray<readonly [string, string]>,
	) => (
		<SelectInput
			id={key}
			label={label}
			value={form[key]}
			onChange={set(key)}
			options={options}
			error={errorFor(key)}
		/>
	);

	async function submit(e: FormEvent) {
		e.preventDefault();
		const local = validatePatient(form);
		if (!local.ok) {
			setErrors(local.errors);
			setFormError(t.form.fixFields);
			return;
		}
		setErrors({});
		setFormError(null);
		setSaving(true);
		try {
			const res = await api.save(form);
			if (res.ok) {
				onSaved(res.patient.id);
				return;
			}
			setErrors(res.errors);
			setFormError(Object.keys(res.errors).length > 0 ? t.form.fixFields : t.form.saveFailed);
		} catch {
			setFormError(t.form.saveFailedRetry);
		} finally {
			setSaving(false);
		}
	}

	const partialBirthDate = form.birthDate !== "" && !FULL_DATE.test(form.birthDate);
	const isBrazil = form.country === "BR";
	const cancelTo = patient ? `/patients/${patient.id}` : "/patients";

	return (
		<form onSubmit={submit} noValidate className="mx-auto max-w-3xl">
			<h1 className="text-3xl font-bold tracking-tight">
				{patient ? t.form.editTitle : t.common.newPatient}
			</h1>
			<p className="mt-1 text-sm text-muted-foreground">{t.form.intro}</p>

			<div className="mt-6 space-y-6">
				<Section legend={t.sections.identification}>
					{text("name", f.name, { required: true, autoComplete: "name", wide: true })}
					{text("socialName", f.socialName, { description: f.socialNameHint, wide: true })}
					{select(
						"gender",
						f.gender,
						GENDERS.map((g) => [g, t.gender[g]]),
					)}
					<Field data-invalid={errors.birthDate ? true : undefined}>
						<FieldLabel htmlFor="birthDate">
							{f.birthDate}
							<Required />
						</FieldLabel>
						<div className="flex items-center gap-2">
							<DateInput
								id="birthDate"
								value={partialBirthDate ? "" : form.birthDate}
								onChange={(value) => {
									set("birthDate")(value);
									setAgeText("");
								}}
								invalid={Boolean(errors.birthDate)}
								locale={locale}
								placeholder={t.form.pickDate}
							/>
							<span className="text-xs text-muted-foreground">{t.form.or}</span>
							<Input
								id="age"
								type="number"
								min={0}
								max={130}
								inputMode="numeric"
								value={ageText}
								onChange={(e) => {
									const raw = e.target.value;
									setAgeText(raw);
									const age = Number(raw);
									set("birthDate")(raw !== "" && age >= 0 ? birthDateFromAge(age) : "");
								}}
								aria-label={t.form.ageLabel}
								placeholder={t.form.agePlaceholder}
								className="w-20"
							/>
						</div>
						{partialBirthDate ? (
							<FieldDescription>
								{t.form.approximate(formatBirthDate(form.birthDate))}
							</FieldDescription>
						) : null}
						<FieldError>{errorFor("birthDate")}</FieldError>
					</Field>
					{patient ? (
						<label className="flex items-center gap-2 text-sm sm:col-span-2">
							<Checkbox
								checked={form.active}
								onCheckedChange={(checked) =>
									setForm((prev) => ({ ...prev, active: checked === true }))
								}
							/>
							{t.form.activeRecord}
						</label>
					) : null}
				</Section>

				<Section legend={t.sections.identifiers}>
					{text("cpf", f.cpf, { inputMode: "numeric", placeholder: "000.000.000-00" })}
					{text("cns", f.cns, { inputMode: "numeric", placeholder: f.cnsPlaceholder })}
					{text("passport", f.passport)}
				</Section>

				<Section legend={t.sections.contact}>
					{text("phone", f.phone, { type: "tel", autoComplete: "tel" })}
					{text("email", f.email, { type: "email", autoComplete: "email" })}
					{select(
						"preferredLanguage",
						f.preferredLanguage,
						LANGUAGES.map((l) => [l, t.language[l]]),
					)}
				</Section>

				<Section legend={t.sections.address}>
					{select("country", f.country, countries)}
					{text("postalCode", isBrazil ? f.cep : f.postalCode, {
						autoComplete: "postal-code",
						inputMode: isBrazil ? "numeric" : undefined,
					})}
					{text("addressLine", f.street, { autoComplete: "address-line1", wide: true })}
					{text("addressNumber", f.number)}
					{text("addressComplement", f.complement)}
					{text("district", f.district)}
					{text("city", f.city, { autoComplete: "address-level2" })}
					{isBrazil
						? select(
								"state",
								f.state,
								BR_STATES.map((s) => [s, s]),
							)
						: text("state", f.stateProvince, { autoComplete: "address-level1" })}
				</Section>

				<Section legend={t.sections.family}>
					{text("motherName", f.motherName, { wide: true })}
					{select(
						"maritalStatus",
						f.maritalStatus,
						MARITAL_STATUSES.map((s) => [s, t.maritalStatus[s]]),
					)}
					{select(
						"raceColor",
						f.raceColor,
						RACE_COLORS.map((r) => [r, t.raceColor[r]]),
					)}
					{select("nationality", f.nationality, countries)}
				</Section>

				<Section legend={t.sections.emergency}>
					{text("emergencyContactName", f.contactName)}
					{text("emergencyContactRelationship", f.relationship, {
						placeholder: f.relationshipPlaceholder,
					})}
					{text("emergencyContactPhone", f.phone, { type: "tel" })}
				</Section>
			</div>

			{formError ? (
				<Alert variant="destructive" className="mt-6 px-3 py-2 text-sm">
					{formError}
				</Alert>
			) : null}

			<div className="mt-6 flex justify-end gap-2">
				<Button variant="outline" nativeButton={false} render={<Link to={cancelTo} />}>
					{t.form.cancel}
				</Button>
				<Button type="submit" disabled={saving}>
					{saving ? <Spinner /> : null}
					{patient ? t.form.saveChanges : t.common.registerPatient}
				</Button>
			</div>
		</form>
	);
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
	return (
		<FieldSet className="rounded-2xl border border-border bg-card p-5 shadow-sm">
			<FieldLegend>{legend}</FieldLegend>
			<div className="grid gap-4 sm:grid-cols-2">{children}</div>
		</FieldSet>
	);
}

/** Required-field marker (decorative — inputs carry the semantics). */
function Required() {
	return <AsteriskIcon className="size-3 text-destructive" aria-hidden="true" />;
}

interface TextInputProps {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	error?: string;
	description?: string;
	required?: boolean;
	wide?: boolean;
	type?: string;
	inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
	autoComplete?: string;
	placeholder?: string;
}

function TextInput({
	id,
	label,
	value,
	onChange,
	error,
	description,
	required,
	wide,
	...input
}: TextInputProps) {
	return (
		<Field data-invalid={error ? true : undefined} className={wide ? "sm:col-span-2" : undefined}>
			<FieldLabel htmlFor={id}>
				{label}
				{required ? <Required /> : null}
			</FieldLabel>
			<Input
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				aria-invalid={error ? true : undefined}
				aria-required={required || undefined}
				{...input}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
			<FieldError>{error}</FieldError>
		</Field>
	);
}

function SelectInput({
	id,
	label,
	value,
	onChange,
	options,
	error,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<readonly [string, string]>;
	error?: string;
}) {
	// Base UI models "nothing selected" as null; the record stores "".
	const items = [{ value: null, label: "—" }, ...options.map(([v, l]) => ({ value: v, label: l }))];
	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={items}
				value={value === "" ? null : value}
				onValueChange={(v) => onChange(v ?? "")}
			>
				<SelectTrigger id={id} aria-invalid={error ? true : undefined} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{items.map((item) => (
						<SelectItem key={item.value ?? ""} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<FieldError>{error}</FieldError>
		</Field>
	);
}

/** "YYYY-MM-DD" ↔ local Date — no UTC round-trip, so the day never shifts. */
const toDate = (value: string): Date | undefined => {
	if (!FULL_DATE.test(value)) return undefined;
	const [y, m, d] = value.split("-").map(Number);
	return new Date(y, m - 1, d);
};

const toFhirDate = (date: Date): string =>
	[
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");

const FIRST_MONTH = new Date(1900, 0);

/**
 * react-day-picker locales per app locale. English is explicit (not the library
 * default): the design-system Calendar formats month names with the locale
 * code, and `undefined` falls back to the host system locale.
 */
const CALENDAR_LOCALES: Partial<Record<PatientLocale, CalendarLocale>> = {
	en: enUS,
	"pt-BR": ptBR,
};

/** Exact-date picker: design-system Calendar in a Popover; value is a FHIR date or "". */
function DateInput({
	id,
	value,
	onChange,
	invalid,
	locale,
	placeholder,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	invalid?: boolean;
	locale: string;
	placeholder: string;
}) {
	const [open, setOpen] = useState(false);
	const selected = toDate(value);
	const [today] = useState(() => new Date());
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				id={id}
				aria-invalid={invalid || undefined}
				render={
					<Button
						variant="outline"
						className="flex-1 justify-start font-normal data-[empty=true]:text-muted-foreground"
						data-empty={selected ? undefined : true}
					/>
				}
			>
				<CalendarIcon />
				{selected ? formatBirthDate(value) : placeholder}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar
					mode="single"
					captionLayout="dropdown"
					locale={CALENDAR_LOCALES[locale as PatientLocale]}
					selected={selected}
					defaultMonth={selected}
					startMonth={FIRST_MONTH}
					endMonth={today}
					disabled={{ after: today }}
					onSelect={(date) => {
						onChange(date ? toFhirDate(date) : "");
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
