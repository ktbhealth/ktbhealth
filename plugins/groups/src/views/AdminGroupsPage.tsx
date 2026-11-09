import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import type { AdminGroupRow } from "../index.ts";

const fmtDate = (d: Date) => d.toLocaleString();

/**
 * /platform/groups console view — cross-owner group listing for
 * platform admins. Dense/utilitarian by design (system console).
 */
export function AdminGroupsPage({ groups }: { groups: AdminGroupRow[] }) {
	return (
		<div>
			<h1 className="font-mono text-lg font-bold tracking-tight">Groups</h1>
			<p className="mt-1 font-mono text-xs text-muted-foreground">
				{groups.length === 0
					? "No groups registered."
					: `${groups.length} group${groups.length === 1 ? "" : "s"} across the platform.`}
			</p>
			{groups.length === 0 ? (
				<Empty className="mt-6 border">
					<EmptyHeader>
						<EmptyTitle>No groups</EmptyTitle>
						<EmptyDescription>Groups appear here once they are created.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14">Id</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Slug</TableHead>
								<TableHead>Kind</TableHead>
								<TableHead className="text-right">Members</TableHead>
								<TableHead className="text-right">Created</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{groups.map((g) => (
								<TableRow key={g.id}>
									<TableCell className="font-mono text-xs text-muted-foreground">{g.id}</TableCell>
									<TableCell className="font-medium">{g.name}</TableCell>
									<TableCell className="font-mono text-xs">{g.slug}</TableCell>
									<TableCell>{g.kind}</TableCell>
									<TableCell className="text-right font-mono text-xs">{g.memberCount}</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{fmtDate(g.createdAt)}
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
