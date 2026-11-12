import { Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@ktbhealth/ui/components/button";
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

import { patientDeleteApi } from "../apis.ts";
import type { AdminPatientRow, OwnerOption } from "../index.ts";
import { patientMessages } from "../i18n.ts";
import { AdminPatientCreateDialog } from "./AdminPatientCreateDialog.tsx";
import { DeletePatientDialog } from "./DeletePatientDialog.tsx";

const SEARCH_CLS = "w-56 sm:w-64";

/**
 * /platform/patients console view — cross-owner patient CRUD for
 * platform admins. Dense/utilitarian by design (system console).
 * Edit reuses the owner-facing form (admin override in the service);
 * delete runs the same cascade dialog as the doctor surface.
 */
export function AdminPatientsPage({
	patients,
	owners,
	locale = "en",
}: {
	patients: AdminPatientRow[];
	/** User accounts for the create form's owner picker. */
	owners: OwnerOption[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = patientMessages(locale);
	const router = useRouter();
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	const [q, setQ] = useState("");
	const [creating, setCreating] = useState(false);
	const [toDelete, setToDelete] = useState<{ id: number; name: string } | null>(null);
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return patients;
		return patients.filter((p) =>
			[p.name, p.ownerName, p.ownerEmail].filter(Boolean).join(" ").toLowerCase().includes(needle),
		);
	}, [patients, needle]);
	return (
		<PageContainer>
			<PageHeader
				title={t.admin.title}
				description={patients.length === 0 ? t.admin.none : t.admin.count(patients.length)}
				actions={
					<Button size="sm" onClick={() => setCreating(true)}>
						<PlusIcon />
						{t.admin.newPatient}
					</Button>
				}
			/>
			{patients.length === 0 ? (
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
							needle === "" ? undefined : t.admin.filteredCount(shown.length, patients.length)
						}
					/>
					<div className="overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-14">{t.admin.colId}</TableHead>
									<TableHead>{t.admin.colName}</TableHead>
									<TableHead>{t.admin.colOwner}</TableHead>
									<TableHead>{t.admin.colOwnerId}</TableHead>
									<TableHead className="text-right">{t.admin.colCreated}</TableHead>
									<TableHead className="w-24 text-right">{t.admin.colActions}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={6} className="text-xs text-muted-foreground">
											{t.admin.noMatch}
										</TableCell>
									</TableRow>
								) : (
									shown.map((p) => (
										<TableRow key={p.id}>
											<TableCell className="text-xs text-muted-foreground">{p.id}</TableCell>
											<TableCell className="font-medium">
												<Link
													to="/patients/$id"
													params={{ id: String(p.id) }}
													className="hover:underline"
												>
													{p.name}
												</Link>
											</TableCell>
											<TableCell>{p.ownerName ?? p.ownerEmail ?? "—"}</TableCell>
											<TableCell className="text-xs text-muted-foreground">{p.ownerId}</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(p.createdAt)}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														aria-label={t.actions.editFor(p.name)}
														render={<Link to="/patients/$id/edit" params={{ id: String(p.id) }} />}
													>
														<PencilIcon />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														aria-label={t.actions.deleteFor(p.name)}
														onClick={() => setToDelete({ id: p.id, name: p.name })}
													>
														<Trash2Icon />
													</Button>
												</div>
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
				<AdminPatientCreateDialog
					owners={owners}
					t={t}
					locale={locale}
					onClose={() => setCreating(false)}
				/>
			) : null}
			<DeletePatientDialog
				patient={toDelete}
				api={patientDeleteApi}
				t={t}
				onClose={() => setToDelete(null)}
				onDeleted={() => {
					setToDelete(null);
					void router.invalidate();
				}}
			/>
		</PageContainer>
	);
}
