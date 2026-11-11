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
import { groupMessages } from "../i18n.ts";

/**
 * /platform/groups console view — cross-owner group listing for
 * platform admins. Dense/utilitarian by design (system console).
 */
export function AdminGroupsPage({
	groups,
	locale = "en",
}: {
	groups: AdminGroupRow[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = groupMessages(locale);
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	return (
		<div>
			<h1 className="text-lg font-bold tracking-tight">{t.title}</h1>
			<p className="mt-1 text-xs text-muted-foreground">
				{groups.length === 0 ? t.none : t.count(groups.length)}
			</p>
			{groups.length === 0 ? (
				<Empty className="mt-6 border">
					<EmptyHeader>
						<EmptyTitle>{t.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="mt-6 overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-14">{t.colId}</TableHead>
								<TableHead>{t.colName}</TableHead>
								<TableHead>{t.colSlug}</TableHead>
								<TableHead>{t.colKind}</TableHead>
								<TableHead className="text-right">{t.colMembers}</TableHead>
								<TableHead className="text-right">{t.colCreated}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{groups.map((g) => (
								<TableRow key={g.id}>
									<TableCell className="text-xs text-muted-foreground">{g.id}</TableCell>
									<TableCell className="font-medium">{g.name}</TableCell>
									<TableCell className="text-xs">{g.slug}</TableCell>
									<TableCell>{g.kind}</TableCell>
									<TableCell className="text-right text-xs">{g.memberCount}</TableCell>
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
