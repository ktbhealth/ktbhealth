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

import type { AdminConsultationRow } from "../index.ts";
import { consultationMessages } from "../i18n.ts";

const SEARCH_CLS = "w-56 sm:w-64";

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
	const [q, setQ] = useState("");
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return consultations;
		return consultations.filter((c) =>
			[c.patientName, c.ownerName, c.ownerEmail]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [consultations, needle]);
	return (
		<PageContainer>
			<PageHeader
				title={t.admin.title}
				description={
					consultations.length === 0 ? t.admin.none : t.admin.count(consultations.length)
				}
			/>
			{consultations.length === 0 ? (
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
							needle === "" ? undefined : t.admin.filteredCount(shown.length, consultations.length)
						}
					/>
					<div className="overflow-hidden rounded-lg border border-border">
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
								{shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="text-xs text-muted-foreground">
											{t.admin.noMatch}
										</TableCell>
									</TableRow>
								) : (
									shown.map((c) => (
										<TableRow key={c.id}>
											<TableCell className="text-xs text-muted-foreground">{c.id}</TableCell>
											<TableCell className="font-medium">{c.status}</TableCell>
											<TableCell className="text-muted-foreground">{c.source}</TableCell>
											<TableCell>
												{c.patientName ? (
													<Link
														to="/consultations/$id"
														params={{ id: String(c.id) }}
														className="font-medium hover:underline"
													>
														{c.patientName}
													</Link>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell>{c.ownerName ?? c.ownerEmail ?? "—"}</TableCell>
											<TableCell className="text-muted-foreground">{c.audioStatus}</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(c.createdAt)}
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
