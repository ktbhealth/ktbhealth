import { Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@ktbhealth/ui/components/button";
import { ConfirmDialog } from "@ktbhealth/ui/components/confirm-dialog";
import { DataToolbar } from "@ktbhealth/ui/components/data-toolbar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import { Input } from "@ktbhealth/ui/components/input";
import { PageContainer } from "@ktbhealth/ui/components/page-container";
import { PageHeader } from "@ktbhealth/ui/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import { adminDeleteConsultationFn } from "../fns.ts";
import type { AdminConsultationRow } from "../index.ts";
import { consultationMessages } from "../i18n.ts";
import type { ConsultationPatientOption } from "../platform-page.tsx";
import type { OwnerOption } from "@ktb/patients";
import { AdminConsultationCreateDialog } from "./AdminConsultationCreateDialog.tsx";

const SEARCH_CLS = "w-56 sm:w-64";

const rowLabel = (c: AdminConsultationRow) =>
	c.patientName ?? c.ownerName ?? c.ownerEmail ?? `#${c.id}`;

/**
 * /platform/consultations console view — cross-owner consultation
 * list/create/delete for platform admins. Records stay immutable:
 * there is no edit (a consultation is a signed record); delete runs
 * through the destructive ConfirmDialog and purges the recording.
 */
export function AdminConsultationsPage({
	consultations,
	owners,
	patients,
	locale = "en",
}: {
	consultations: AdminConsultationRow[];
	/** User accounts for the create form's owner picker. */
	owners: OwnerOption[];
	/** Patients for the create form's patient picker. */
	patients: ConsultationPatientOption[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = consultationMessages(locale);
	const router = useRouter();
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	const [q, setQ] = useState("");
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<AdminConsultationRow | null>(null);
	const [busy, setBusy] = useState(false);
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return consultations;
		return consultations.filter((c) =>
			[c.patientName, c.ownerName, c.ownerEmail]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [consultations, needle]);

	const confirmDelete = async () => {
		/* v8 ignore next -- the confirm action only exists while a row is targeted */
		if (toDelete === null) return;
		setBusy(true);
		try {
			const res = await adminDeleteConsultationFn({ data: toDelete.id });
			if (res.ok) {
				setToDelete(null);
				await router.invalidate();
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<PageContainer>
			<PageHeader
				title={t.admin.title}
				description={
					consultations.length === 0 ? t.admin.none : t.admin.count(consultations.length)
				}
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						{t.admin.newConsultation}
					</Button>
				}
			/>
			{consultations.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>{t.admin.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.admin.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<DataToolbar
						search={
							<Input
								type="search"
								value={q}
								onChange={(e) => setQ(e.target.value)}
								placeholder={t.admin.searchPlaceholder}
								aria-label={t.admin.searchLabel}
								className={SEARCH_CLS}
							/>
						}
						resultCount={
							needle === "" ? undefined : t.admin.filteredCount(shown.length, consultations.length)
						}
					/>
					<div className="overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-14">{t.admin.colId}</TableHead>
									<TableHead>{t.admin.colStatus}</TableHead>
									<TableHead>{t.admin.colSource}</TableHead>
									<TableHead>{t.admin.colPatient}</TableHead>
									<TableHead>{t.admin.colOwner}</TableHead>
									<TableHead>{t.admin.colAudio}</TableHead>
									<TableHead className="text-right">{t.admin.colCreated}</TableHead>
									<TableHead className="w-16 text-right">{t.admin.colActions}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={8} className="text-xs text-muted-foreground">
											{t.admin.noMatch}
										</TableCell>
									</TableRow>
								) : (
									shown.map((c) => (
										<TableRow key={c.id}>
											<TableCell className="text-xs text-muted-foreground">{c.id}</TableCell>
											<TableCell className="font-medium">{c.status}</TableCell>
											<TableCell className="text-muted-foreground">{c.source}</TableCell>
											<TableCell>
												{c.patientName ? (
													<Link
														to="/consultations/$id"
														params={{ id: String(c.id) }}
														className="font-medium hover:underline"
													>
														{c.patientName}
													</Link>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell>{c.ownerName ?? c.ownerEmail ?? "—"}</TableCell>
											<TableCell className="text-muted-foreground">{c.audioStatus}</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(c.createdAt)}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="icon"
													aria-label={t.admin.deleteFor(rowLabel(c))}
													onClick={() => setToDelete(c)}
												>
													<Trash2Icon />
												</Button>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</>
			)}
			{creating ? (
				<AdminConsultationCreateDialog
					owners={owners}
					patients={patients}
					t={t}
					onClose={() => setCreating(false)}
				/>
			) : null}
			{toDelete !== null ? (
				<ConfirmDialog
					open
					onOpenChange={(open) => {
						/* v8 ignore next -- mounted only while deleting; only close events fire */
						if (!open) setToDelete(null);
					}}
					title={t.admin.deleteTitle}
					description={t.admin.deleteDescription(rowLabel(toDelete))}
					confirmLabel={t.admin.deleteConfirm}
					cancelLabel={t.admin.cancel}
					variant="destructive"
					loading={busy}
					onConfirm={confirmDelete}
				/>
			) : null}
		</PageContainer>
	);
}
