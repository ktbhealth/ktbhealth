import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import type { AdminUserRow } from "../index.ts";
import { userMessages } from "../i18n.ts";

/**
 * /platform/users console view — cross-owner user listing for platform
 * admins. Dense/utilitarian by design (system console).
 */
export function AdminUsersPage({
	users,
	locale = "en",
}: {
	users: AdminUserRow[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = userMessages(locale);
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	return (
		<div>
			<h1 className="text-lg font-bold tracking-tight">{t.title}</h1>
			<p className="mt-1 text-xs text-muted-foreground">
				{users.length === 0 ? t.none : t.count(users.length)}
			</p>
			{users.length === 0 ? (
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
								<TableHead>{t.colEmail}</TableHead>
								<TableHead>{t.colVerified}</TableHead>
								<TableHead className="text-right">{t.colPatients}</TableHead>
								<TableHead className="text-right">{t.colConsultations}</TableHead>
								<TableHead>{t.colRole}</TableHead>
								<TableHead className="text-right">{t.colCreated}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((u) => (
								<TableRow key={u.id}>
									<TableCell className="text-xs text-muted-foreground">{u.id}</TableCell>
									<TableCell className="font-medium">{u.name}</TableCell>
									<TableCell>{u.email}</TableCell>
									<TableCell>{u.emailVerified ? t.yes : t.no}</TableCell>
									<TableCell className="text-right text-xs">{u.patientCount}</TableCell>
									<TableCell className="text-right text-xs">{u.consultationCount}</TableCell>
									<TableCell>
										{u.isAdmin ? (
											<span className="text-xs font-semibold text-foreground">{t.roleAdmin}</span>
										) : (
											<span className="text-muted-foreground">{t.roleUser}</span>
										)}
									</TableCell>
									<TableCell className="text-right text-muted-foreground">
										{fmtDate(u.createdAt)}
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
