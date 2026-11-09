import { useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { Alert } from "@ktbhealth/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@ktbhealth/ui/components/alert-dialog";
import { Checkbox } from "@ktbhealth/ui/components/checkbox";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import type { PatientMessages } from "../i18n.ts";

/** Host-injected deletion: impact preview + the cascade itself. */
export interface PatientDeleteApi {
	/** How many consultations go with the patient; null when not visible. */
	impact(id: number): Promise<{ readonly consultations: number } | null>;
	remove(id: number): Promise<{ readonly ok: boolean }>;
}

/**
 * Confirmation for the irreversible patient cascade. The consultation
 * count is fetched when the dialog opens (never stale), stated
 * explicitly, and — when there are consultations — must be acknowledged
 * with a checkbox before the delete button enables.
 */
interface DialogProps {
	api: PatientDeleteApi;
	t: PatientMessages;
	onClose: () => void;
	onDeleted: (id: number) => void;
}

export function DeletePatientDialog({
	patient,
	...props
}: DialogProps & {
	/** The patient to delete; null keeps the dialog closed. */
	patient: { readonly id: number; readonly name: string } | null;
}) {
	// Keyed per patient: every opening starts from a fresh impact check.
	return patient ? <OpenDialog key={patient.id} patient={patient} {...props} /> : null;
}

function OpenDialog({
	patient,
	api,
	t,
	onClose,
	onDeleted,
}: DialogProps & { patient: { readonly id: number; readonly name: string } }) {
	const [consultations, setConsultations] = useState<number | null>(null);
	const [acknowledged, setAcknowledged] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [failed, setFailed] = useState(false);

	const { id } = patient;
	useEffect(() => {
		let live = true;
		api.impact(id).then(
			(impact) => {
				if (!live) return;
				if (impact) setConsultations(impact.consultations);
				else setFailed(true);
			},
			() => live && setFailed(true),
		);
		return () => {
			live = false;
		};
	}, [api, id]);

	async function confirm() {
		setDeleting(true);
		setFailed(false);
		try {
			const res = await api.remove(patient.id);
			if (res.ok) onDeleted(patient.id);
			else setFailed(true);
		} catch {
			setFailed(true);
		} finally {
			setDeleting(false);
		}
	}

	const ready = consultations !== null && (consultations === 0 || acknowledged);

	return (
		<AlertDialog open onOpenChange={(open) => !open && !deleting && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="flex items-center gap-2">
						<TriangleAlertIcon className="size-4 text-destructive" />
						{t.remove.title}
					</AlertDialogTitle>
					<AlertDialogDescription>{t.remove.body(patient.name)}</AlertDialogDescription>
				</AlertDialogHeader>

				{consultations === null && !failed ? (
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<Spinner />
						{t.remove.checking}
					</p>
				) : null}
				{consultations === 0 ? (
					<p className="text-sm text-muted-foreground">{t.remove.noConsultations}</p>
				) : null}
				{consultations !== null && consultations > 0 ? (
					<>
						<Alert variant="destructive" className="px-3 py-2 text-sm">
							{t.remove.withConsultations(consultations)}
						</Alert>
						<label className="flex items-start gap-2 text-sm">
							<Checkbox
								checked={acknowledged}
								onCheckedChange={(checked) => setAcknowledged(checked === true)}
							/>
							{t.remove.acknowledge(consultations)}
						</label>
					</>
				) : null}
				{failed ? (
					<Alert variant="destructive" className="px-3 py-2 text-sm">
						{t.remove.failed}
					</Alert>
				) : null}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={deleting}>{t.remove.cancel}</AlertDialogCancel>
					<AlertDialogAction variant="destructive" disabled={!ready || deleting} onClick={confirm}>
						{deleting ? <Spinner /> : null}
						{t.remove.confirm}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
