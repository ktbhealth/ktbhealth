import { useMemo, useState } from "react";

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

import type { AdminUserRow } from "../index.ts";
import { userMessages } from "../i18n.ts";

const SEARCH_CLS = "w-56 sm:w-64";

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
	const [q, setQ] = useState("");
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return users;
		return users.filter((u) =>
			[u.name, u.email].filter(Boolean).join(" ").toLowerCase().includes(needle),
		);
	}, [users, needle]);
	return (
		<PageContainer>
			<PageHeader
				title={t.title}
				description={users.length === 0 ? t.none : t.count(users.length)}
			/>
			{users.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>{t.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.emptyDescription}</EmptyDescription>
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
								placeholder={t.searchPlaceholder}
								aria-label={t.searchLabel}
								className={SEARCH_CLS}
							/>
						}
						resultCount={needle === "" ? undefined : t.filteredCount(shown.length, users.length)}
					/>
					<div className="overflow-hidden rounded-lg border border-border">
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
								{shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={8} className="text-xs text-muted-foreground">
											{t.noMatch}
										</TableCell>
									</TableRow>
								) : (
									shown.map((u) => (
										<TableRow key={u.id}>
											<TableCell className="text-xs text-muted-foreground">{u.id}</TableCell>
											<TableCell className="font-medium">{u.name}</TableCell>
											<TableCell>{u.email}</TableCell>
											<TableCell>{u.emailVerified ? t.yes : t.no}</TableCell>
											<TableCell className="text-right text-xs">{u.patientCount}</TableCell>
											<TableCell className="text-right text-xs">{u.consultationCount}</TableCell>
											<TableCell>
												{u.isAdmin ? (
													<span className="text-xs font-semibold text-foreground">
														{t.roleAdmin}
													</span>
												) : (
													<span className="text-muted-foreground">{t.roleUser}</span>
												)}
											</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(u.createdAt)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</>
			)}
		</PageContainer>
	);
}
