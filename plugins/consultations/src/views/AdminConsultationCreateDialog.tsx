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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";
import { Textarea } from "@ktbhealth/ui/components/textarea";

import { adminCreateConsultationFn } from "../fns.ts";
import type { ConsultationMessages } from "../i18n.ts";
import type { ConsultationPatientOption } from "../platform-page.tsx";
import type { OwnerOption } from "@ktb/patients";

const NONE = "__none__";

/**
 * Platform-admin quick create: picks the owning user (and optionally
 * one of that owner's patients), plus an optional transcript. Source
 * defaults to "manual" and status to "done" server-side.
 */
export function AdminConsultationCreateDialog({
	owners,
	patients,
	t,
	onClose,
}: {
	owners: readonly OwnerOption[];
	patients: readonly ConsultationPatientOption[];
	t: ConsultationMessages;
	onClose: () => void;
}) {
	const router = useRouter();
	const [ownerId, setOwnerId] = useState("");
	const [patientId, setPatientId] = useState("");
	const [transcript, setTranscript] = useState("");
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const ownerPatients = patients.filter((p) => p.ownerId === ownerId);

	const submit = async () => {
		/* v8 ignore next -- the submit button is disabled while busy or ownerless */
		if (ownerId === "" || busy) return;
		setBusy(true);
		setFailed(false);
		try {
			const res = await adminCreateConsultationFn({
				data: {
					userId: ownerId,
					...(patientId === "" ? {} : { patientId: Number(patientId) }),
					...(transcript.trim() === "" ? {} : { transcript }),
				},
			});
			if (!res.ok) {
				setFailed(true);
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
							value={ownerId === "" ? NONE : ownerId}
							onValueChange={(v) => {
								setOwnerId(v === NONE ? "" : String(v));
								setPatientId("");
							}}
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
						<FieldLabel>{t.admin.patientLabel}</FieldLabel>
						<Select
							items={[
								{ value: NONE, label: t.admin.patientNone },
								...ownerPatients.map((p) => ({
									value: String(p.id),
									label: `${p.name} — ${p.ownerName}`,
								})),
							]}
							value={patientId === "" ? NONE : patientId}
							onValueChange={(v) => setPatientId(v === NONE ? "" : String(v))}
							disabled={ownerId === ""}
						>
							<SelectTrigger aria-label={t.admin.patientLabel}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{[
									{ value: NONE, label: t.admin.patientNone },
									...ownerPatients.map((p) => ({
										value: String(p.id),
										label: `${p.name} — ${p.ownerName}`,
									})),
								].map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor="admin-consultation-transcript">
							{t.admin.transcriptLabel}
						</FieldLabel>
						<Textarea
							id="admin-consultation-transcript"
							value={transcript}
							onChange={(e) => setTranscript(e.target.value)}
							placeholder={t.admin.transcriptPlaceholder}
							rows={4}
						/>
					</Field>
					{failed ? <p className="text-sm text-destructive">{t.admin.createFailed}</p> : null}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose} disabled={busy}>
							{t.admin.cancel}
						</Button>
						<Button type="submit" disabled={busy || ownerId === ""}>
							{t.admin.newConsultation}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
