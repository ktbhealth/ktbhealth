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

const fmtDate = (d: Date) => d.toLocaleString();

/**
 * /platform/consultations console view — cross-owner consultation
 * listing for platform admins. Dense/utilitarian by design.
 */
export function AdminConsultationsPage({
	consultations,
}: {
	consultations: AdminConsultationRow[];
}) {
	return (
		<div>
			<h1 className="text-lg font-bold tracking-tight">Consultations</h1>
			<p className="mt-1 text-xs text-muted-foreground">
				{consultations.length === 0
					? "No consultations yet."
					: `${consultations.length} consultation${consultations.length === 1 ? "" : "s"} across all owners.`}
			</p>
			{consultations.length === 0 ? (
				<Empty className="mt-6 border">
					<EmptyHeader>
						<EmptyTitle>No consultations</EmptyTitle>
						<EmptyDescription>Consultations appear here once created.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14">Id</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Source</TableHead>
								<TableHead>Patient</TableHead>
								<TableHead>Owner</TableHead>
								<TableHead>Audio</TableHead>
								<TableHead className="text-right">Created</TableHead>
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
