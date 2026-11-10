import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import type { AdminConsultationRow } from "../index.ts";
import { consultationMessages } from "../i18n.ts";

/**
 * /platform/consultations console view — cross-owner consultation
 * listing for platform admins. Dense/utilitarian by design.
 */
export function AdminConsultationsPage({
	consultations,
	locale = "en",
}: {
	consultations: AdminConsultationRow[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = consultationMessages(locale);
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	return (
		<div>
			<h1 className="text-lg font-bold tracking-tight">{t.admin.title}</h1>
			<p className="mt-1 text-xs text-muted-foreground">
				{consultations.length === 0 ? t.admin.none : t.admin.count(consultations.length)}
			</p>
			{consultations.length === 0 ? (
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
								<TableHead>{t.admin.colStatus}</TableHead>
								<TableHead>{t.admin.colSource}</TableHead>
								<TableHead>{t.admin.colPatient}</TableHead>
								<TableHead>{t.admin.colOwner}</TableHead>
								<TableHead>{t.admin.colAudio}</TableHead>
								<TableHead className="text-right">{t.admin.colCreated}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{consultations.map((c) => (
								<TableRow key={c.id}>
									<TableCell className="text-xs text-muted-foreground">{c.id}</TableCell>
									<TableCell className="font-medium">{c.status}</TableCell>
									<TableCell className="text-muted-foreground">{c.source}</TableCell>
									<TableCell>{c.patientName ?? "—"}</TableCell>
									<TableCell>{c.ownerName ?? c.ownerEmail ?? "—"}</TableCell>
									<TableCell className="text-muted-foreground">{c.audioStatus}</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{fmtDate(c.createdAt)}
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
