import { Link } from "@tanstack/react-router";
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

import type { AdminPatientRow } from "../index.ts";
import { patientMessages } from "../i18n.ts";

const SEARCH_CLS = "w-56 sm:w-64";

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
	const [q, setQ] = useState("");
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
								</TableRow>
							</TableHeader>
							<TableBody>
								{shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={5} className="text-xs text-muted-foreground">
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
