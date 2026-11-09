import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type HTMLAttributes, type ReactNode } from "react";
import { AsteriskIcon } from "lucide-react";

import { Alert } from "@ktbhealth/ui/components/alert";
import { Button } from "@ktbhealth/ui/components/button";
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
import { NativeSelect, NativeSelectOption } from "@ktbhealth/ui/components/native-select";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import type { Patient } from "../index.ts";
import {
	ageFromBirthDate,
	birthDateFromAge,
	BR_STATES,
	COUNTRIES,
	countryName,
	formatBirthDate,
	GENDER_LABELS,
	GENDERS,
	LANGUAGE_LABELS,
	LANGUAGES,
	MARITAL_STATUS_LABELS,
	MARITAL_STATUSES,
	RACE_COLOR_LABELS,
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
const FIX_FIELDS = "Please fix the highlighted fields.";

const COUNTRY_OPTIONS = COUNTRIES.map((c) => [c, countryName(c)] as const).sort((a, b) =>
	a[1].localeCompare(b[1]),
);

export function PatientFormPage({
	patient,
	api,
	onSaved,
}: {
	/** Absent → registration; present → edit. */
	patient?: Patient;
	api: PatientFormApi;
	onSaved: (id: number) => void;
}) {
	const [form, setForm] = useState(() => initialState(patient));
	const [ageText, setAgeText] = useState(() =>
		form.birthDate.length === 4 ? String(ageFromBirthDate(form.birthDate)) : "",
	);
	const [errors, setErrors] = useState<PatientErrors>({});
	const [formError, setFormError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const set = (key: TextField) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

	const text = (key: TextField, label: string, extra: Partial<TextInputProps> = {}) => (
		<TextInput
			id={key}
			label={label}
			value={form[key]}
			onChange={set(key)}
			error={errors[key]}
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
			error={errors[key]}
		/>
	);

	async function submit(e: FormEvent) {
		e.preventDefault();
		const local = validatePatient(form);
		if (!local.ok) {
			setErrors(local.errors);
			setFormError(FIX_FIELDS);
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
			setFormError(Object.keys(res.errors).length > 0 ? FIX_FIELDS : "Could not save the patient.");
		} catch {
			setFormError("Could not save the patient. Try again.");
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
				{patient ? "Edit patient" : "New patient"}
			</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Record based on HL7 FHIR R4 Patient with the Brazilian RNDS extensions. Only name and birth
				date (or age) are required.
			</p>

			<div className="mt-6 space-y-6">
				<Section legend="Identification">
					{text("name", "Full name", { required: true, autoComplete: "name", wide: true })}
					{text("socialName", "Social name", {
						description: "Name the patient goes by; shown first when set.",
						wide: true,
					})}
					{select(
						"gender",
						"Sex (administrative)",
						GENDERS.map((g) => [g, GENDER_LABELS[g]]),
					)}
					<Field data-invalid={errors.birthDate ? true : undefined}>
						<FieldLabel htmlFor="birthDate">
							Birth date
							<Required />
						</FieldLabel>
						<div className="flex items-center gap-2">
							<Input
								id="birthDate"
								type="date"
								value={partialBirthDate ? "" : form.birthDate}
								onChange={(e) => {
									set("birthDate")(e.target.value);
									setAgeText("");
								}}
								aria-invalid={errors.birthDate ? true : undefined}
							/>
							<span className="text-xs text-muted-foreground">or</span>
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
								aria-label="Age in years"
								placeholder="age"
								className="w-20"
							/>
						</div>
						{partialBirthDate ? (
							<FieldDescription>
								Recorded as {formatBirthDate(form.birthDate)} (approximate). Enter the exact date if
								known.
							</FieldDescription>
						) : null}
						<FieldError>{errors.birthDate}</FieldError>
					</Field>
					{patient ? (
						<label className="flex items-center gap-2 text-sm sm:col-span-2">
							<Checkbox
								checked={form.active}
								onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked === true }))}
							/>
							Active record
						</label>
					) : null}
				</Section>

				<Section legend="Identifiers">
					{text("cpf", "CPF", { inputMode: "numeric", placeholder: "000.000.000-00" })}
					{text("cns", "CNS (Cartão SUS)", { inputMode: "numeric", placeholder: "15 digits" })}
					{text("passport", "Passport / foreign ID")}
				</Section>

				<Section legend="Contact">
					{text("phone", "Phone", { type: "tel", autoComplete: "tel" })}
					{text("email", "Email", { type: "email", autoComplete: "email" })}
					{select(
						"preferredLanguage",
						"Preferred language",
						LANGUAGES.map((l) => [l, LANGUAGE_LABELS[l]]),
					)}
				</Section>

				<Section legend="Address">
					{select("country", "Country", COUNTRY_OPTIONS)}
					{text("postalCode", isBrazil ? "CEP" : "Postal code", {
						autoComplete: "postal-code",
						inputMode: isBrazil ? "numeric" : undefined,
					})}
					{text("addressLine", "Street", { autoComplete: "address-line1", wide: true })}
					{text("addressNumber", "Number")}
					{text("addressComplement", "Complement")}
					{text("district", "District")}
					{text("city", "City", { autoComplete: "address-level2" })}
					{isBrazil
						? select(
								"state",
								"State",
								BR_STATES.map((s) => [s, s]),
							)
						: text("state", "State / province", { autoComplete: "address-level1" })}
				</Section>

				<Section legend="Family and demographics">
					{text("motherName", "Mother's name", { wide: true })}
					{select(
						"maritalStatus",
						"Marital status",
						MARITAL_STATUSES.map((s) => [s, MARITAL_STATUS_LABELS[s]]),
					)}
					{select(
						"raceColor",
						"Race / color (IBGE)",
						RACE_COLORS.map((r) => [r, RACE_COLOR_LABELS[r]]),
					)}
					{select("nationality", "Nationality", COUNTRY_OPTIONS)}
				</Section>

				<Section legend="Emergency contact">
					{text("emergencyContactName", "Name")}
					{text("emergencyContactRelationship", "Relationship", { placeholder: "e.g. daughter" })}
					{text("emergencyContactPhone", "Phone", { type: "tel" })}
				</Section>
			</div>

			{formError ? (
				<Alert variant="destructive" className="mt-6 px-3 py-2 text-sm">
					{formError}
				</Alert>
			) : null}

			<div className="mt-6 flex justify-end gap-2">
				<Button variant="outline" nativeButton={false} render={<Link to={cancelTo} />}>
					Cancel
				</Button>
				<Button type="submit" disabled={saving}>
					{saving ? <Spinner /> : null}
					{patient ? "Save changes" : "Register patient"}
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
	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<NativeSelect
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				aria-invalid={error ? true : undefined}
				className="w-full"
			>
				<NativeSelectOption value="">—</NativeSelectOption>
				{options.map(([v, l]) => (
					<NativeSelectOption key={v} value={v}>
						{l}
					</NativeSelectOption>
				))}
			</NativeSelect>
			<FieldError>{error}</FieldError>
		</Field>
	);
}
