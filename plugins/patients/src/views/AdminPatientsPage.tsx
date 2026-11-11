import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import type { AdminPatientRow } from "../index.ts";
import { patientMessages } from "../i18n.ts";

/**
 * /platform/patients console view — cross-owner patient listing for
 * platform admins. Dense/utilitarian by design (system console).
 */
export function AdminPatientsPage({
	patients,
	locale = "en",
}: {
	patients: AdminPatientRow[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = patientMessages(locale);
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	return (
		<div>
			<h1 className="text-lg font-bold tracking-tight">{t.admin.title}</h1>
			<p className="mt-1 text-xs text-muted-foreground">
				{patients.length === 0 ? t.admin.none : t.admin.count(patients.length)}
			</p>
			{patients.length === 0 ? (
				<Empty className="mt-6 border">
					<EmptyHeader>
						<EmptyTitle>{t.admin.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.admin.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14">{t.admin.colId}</TableHead>
								<TableHead>{t.admin.colName}</TableHead>
								<TableHead>{t.admin.colOwner}</TableHead>
								<TableHead>{t.admin.colOwnerId}</TableHead>
								<TableHead className="text-right">{t.admin.colCreated}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{patients.map((p) => (
								<TableRow key={p.id}>
									<TableCell className="text-xs text-muted-foreground">{p.id}</TableCell>
									<TableCell className="font-medium">{p.name}</TableCell>
									<TableCell>{p.ownerName ?? p.ownerEmail ?? "—"}</TableCell>
									<TableCell className="text-xs text-muted-foreground">{p.ownerId}</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{fmtDate(p.createdAt)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
