import { useState } from "react";
import { useRouter } from "@tanstack/react-router";

import { Button } from "@ktbhealth/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ktbhealth/ui/components/dialog";
import { Field, FieldLabel } from "@ktbhealth/ui/components/field";
import { Input } from "@ktbhealth/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";

import { adminCreatePatientFn } from "../fns.ts";
import type { PatientMessages } from "../i18n.ts";
import type { OwnerOption } from "../index.ts";
import { errorMessage, type PatientErrors } from "../record.ts";

const NONE = "__none__";

type FormState = {
	ownerId: string;
	name: string;
	birthDate: string;
	cpf: string;
	cns: string;
	email: string;
	phone: string;
};

const EMPTY: FormState = {
	ownerId: "",
	name: "",
	birthDate: "",
	cpf: "",
	cns: "",
	email: "",
	phone: "",
};

/**
 * Platform-admin quick create: picks the owning user, then the same
 * wire draft the doctor-facing form sends (name + birth date required;
 * the rest optional and editable later on the full form).
 */
export function AdminPatientCreateDialog({
	owners,
	t,
	locale,
	onClose,
}: {
	owners: readonly OwnerOption[];
	t: PatientMessages;
	locale: string;
	onClose: () => void;
}) {
	const router = useRouter();
	const [form, setForm] = useState<FormState>(EMPTY);
	const [errors, setErrors] = useState<PatientErrors>({});
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const set =
		<K extends keyof FormState>(key: K) =>
		(e: { target: { value: string } }) =>
			setForm((f) => ({ ...f, [key]: e.target.value }));

	const fieldError = (key: keyof PatientErrors) => {
		const code = errors[key];
		return code === undefined ? null : (
			<p className="mt-1 text-xs text-destructive">{errorMessage(code, locale)}</p>
		);
	};

	const submit = async () => {
		/* v8 ignore next -- the submit button is disabled while busy or ownerless */
		if (form.ownerId === "" || busy) return;
		setBusy(true);
		setFailed(false);
		setErrors({});
		try {
			const res = await adminCreatePatientFn({
				data: {
					ownerId: form.ownerId,
					name: form.name,
					birthDate: form.birthDate,
					cpf: form.cpf,
					cns: form.cns,
					email: form.email,
					phone: form.phone,
				},
			});
			if (!res.ok) {
				if (Object.keys(res.errors).length > 0) setErrors(res.errors);
				else setFailed(true);
				return;
			}
			onClose();
			await router.invalidate();
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				/* v8 ignore next -- mounted only while creating; only close events fire */
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t.admin.createTitle}</DialogTitle>
				</DialogHeader>
				<p className="text-sm text-muted-foreground">{t.admin.createDescription}</p>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<Field>
						<FieldLabel>{t.admin.ownerLabel}</FieldLabel>
						<Select
							items={[
								{ value: NONE, label: t.admin.ownerPlaceholder },
								...owners.map((o) => ({ value: o.id, label: o.label })),
							]}
							value={form.ownerId === "" ? NONE : form.ownerId}
							onValueChange={(v) =>
								setForm((f) => ({ ...f, ownerId: v === NONE ? "" : String(v) }))
							}
						>
							<SelectTrigger aria-label={t.admin.ownerLabel}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{[
									{ value: NONE, label: t.admin.ownerPlaceholder },
									...owners.map((o) => ({ value: o.id, label: o.label })),
								].map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor="admin-patient-name">{t.fields.name}</FieldLabel>
						<Input id="admin-patient-name" value={form.name} onChange={set("name")} required />
						{fieldError("name")}
					</Field>
					<Field>
						<FieldLabel htmlFor="admin-patient-birthDate">{t.fields.birthDate}</FieldLabel>
						<Input
							id="admin-patient-birthDate"
							type="date"
							value={form.birthDate}
							onChange={set("birthDate")}
							required
						/>
						{fieldError("birthDate")}
					</Field>
					<div className="grid gap-3 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor="admin-patient-cpf">{t.fields.cpf}</FieldLabel>
							<Input id="admin-patient-cpf" value={form.cpf} onChange={set("cpf")} />
							{fieldError("cpf")}
						</Field>
						<Field>
							<FieldLabel htmlFor="admin-patient-cns">{t.fields.cns}</FieldLabel>
							<Input id="admin-patient-cns" value={form.cns} onChange={set("cns")} />
							{fieldError("cns")}
						</Field>
						<Field>
							<FieldLabel htmlFor="admin-patient-email">{t.fields.email}</FieldLabel>
							<Input
								id="admin-patient-email"
								type="email"
								value={form.email}
								onChange={set("email")}
							/>
							{fieldError("email")}
						</Field>
						<Field>
							<FieldLabel htmlFor="admin-patient-phone">{t.fields.phone}</FieldLabel>
							<Input
								id="admin-patient-phone"
								type="tel"
								value={form.phone}
								onChange={set("phone")}
							/>
							{fieldError("phone")}
						</Field>
					</div>
					{failed ? <p className="text-sm text-destructive">{t.admin.createFailed}</p> : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
							{t.form.cancel}
						</Button>
						<Button type="submit" disabled={busy || form.ownerId === ""}>
							{t.admin.newPatient}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
