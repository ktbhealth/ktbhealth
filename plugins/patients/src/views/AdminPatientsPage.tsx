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

const fmtDate = (d: Date) => d.toLocaleString();

/**
 * /platform/patients console view — cross-owner patient listing for
 * platform admins. Dense/utilitarian by design (system console).
 */
export function AdminPatientsPage({ patients }: { patients: AdminPatientRow[] }) {
	return (
		<div>
			<h1 className="text-2xl font-bold tracking-tight">Patients</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				{patients.length === 0
					? "No patients registered."
					: `${patients.length} patient${patients.length === 1 ? "" : "s"} across all owners.`}
			</p>
			{patients.length === 0 ? (
				<Empty className="mt-6 border">
					<EmptyHeader>
						<EmptyTitle>No patients</EmptyTitle>
						<EmptyDescription>Patients appear here once created.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14">Id</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Owner</TableHead>
								<TableHead>Owner id</TableHead>
								<TableHead className="text-right">Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{patients.map((p) => (
								<TableRow key={p.id}>
									<TableCell className="font-mono text-xs text-muted-foreground">{p.id}</TableCell>
									<TableCell className="font-medium">{p.name}</TableCell>
									<TableCell>{p.ownerName ?? p.ownerEmail ?? "—"}</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{p.ownerId}
									</TableCell>
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
