import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	DownloadIcon,
	EllipsisVerticalIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	UsersIcon,
} from "lucide-react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@ktbhealth/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";
import { SearchInput } from "@ktbhealth/ui/components/search-input";
import type { Patient } from "../index.ts";
import { patientMessages } from "../i18n.ts";
import { formatCpf } from "../record.ts";
import { demographics, displayName, initials } from "./-format.ts";
import { exportLinks } from "./-export.ts";
import { DeletePatientDialog, type PatientDeleteApi } from "./DeletePatientDialog.tsx";

export type PatientListItem = Pick<
	Patient,
	"id" | "name" | "socialName" | "gender" | "birthDate" | "cpf" | "cns" | "active"
>;

export function PatientsPage({
	patients,
	locale,
	deleteApi,
	onDeleted,
}: {
	patients: PatientListItem[];
	/** Active UI locale, injected by the host. */
	locale: string;
	deleteApi: PatientDeleteApi;
	/** Called once a patient (and their consultations) are gone — the host refreshes the list. */
	onDeleted: (id: number) => void;
}) {
	const t = patientMessages(locale);
	const [q, setQ] = useState("");
	const [toDelete, setToDelete] = useState<{ id: number; name: string } | null>(null);

	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return patients;
		const digits = needle.replace(/\D/g, "");
		return patients.filter(
			(p) =>
				[p.name, p.socialName].some((t) => t?.toLowerCase().includes(needle)) ||
				(digits !== "" && [p.cpf, p.cns].some((id) => id?.includes(digits))),
		);
	}, [patients, q]);

	return (
		<div>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">{t.common.patients}</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{patients.length === 0 ? t.list.none : t.list.count(patients.length)}
					</p>
				</div>
				<Button nativeButton={false} render={<Link to="/patients/new" />}>
					<PlusIcon data-icon="inline-start" />
					{t.common.newPatient}
				</Button>
			</div>

			{patients.length > 0 ? (
				<SearchInput
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder={t.list.searchPlaceholder}
					aria-label={t.list.searchLabel}
					className="mt-5 w-full max-w-sm"
				/>
			) : null}

			<div className="mt-4 space-y-3">
				{shown.map((p) => (
					<article
						key={p.id}
						className="group relative flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-foreground/20 hover:shadow"
					>
						<div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-semibold text-primary">
							{initials(displayName(p))}
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-baseline gap-x-2">
								<Link
									to="/patients/$id"
									params={{ id: String(p.id) }}
									className="font-semibold after:absolute after:inset-0 after:content-['']"
								>
									{displayName(p)}
								</Link>
								{p.socialName ? (
									<span className="text-xs text-muted-foreground">({p.name})</span>
								) : null}
							</div>
							<p className="mt-0.5 text-sm text-muted-foreground">
								{[demographics(p, locale), p.cpf ? `CPF ${formatCpf(p.cpf)}` : null]
									.filter(Boolean)
									.join(" · ") || t.common.noDemographics}
							</p>
						</div>
						<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
							{!p.active ? <Badge variant="outline">{t.common.inactive}</Badge> : null}
							{!p.birthDate ? <Badge variant="outline">{t.list.incomplete}</Badge> : null}
						</div>
						{/* Above the card's stretched link so the actions stay clickable. */}
						<div className="relative z-10 flex shrink-0 items-center gap-1">
							<Button
								variant="ghost"
								size="icon"
								aria-label={t.actions.editFor(displayName(p))}
								render={<Link to="/patients/$id/edit" params={{ id: String(p.id) }} />}
							>
								<PencilIcon />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t.actions.deleteFor(displayName(p))}
								onClick={() => setToDelete({ id: p.id, name: displayName(p) })}
							>
								<Trash2Icon />
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="ghost"
											size="icon"
											aria-label={t.actions.menu(displayName(p))}
										/>
									}
								>
									<EllipsisVerticalIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-56">
									<DropdownMenuGroup>
										<DropdownMenuLabel>{t.detail.exportRecord}</DropdownMenuLabel>
										{exportLinks(t, p.id).map(({ format, label, href }) => (
											<DropdownMenuItem key={format} render={<a href={href} download />}>
												<DownloadIcon />
												{label}
											</DropdownMenuItem>
										))}
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</article>
				))}

				<DeletePatientDialog
					patient={toDelete}
					api={deleteApi}
					t={t}
					onClose={() => setToDelete(null)}
					onDeleted={(id) => {
						setToDelete(null);
						onDeleted(id);
					}}
				/>

				{patients.length > 0 && shown.length === 0 ? (
					<Empty className="border">
						<EmptyDescription>{t.list.noMatch}</EmptyDescription>
					</Empty>
				) : null}

				{!patients.length ? (
					<Empty className="border bg-card px-6 py-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<UsersIcon />
							</EmptyMedia>
							<EmptyTitle>{t.list.emptyTitle}</EmptyTitle>
							<EmptyDescription>{t.list.emptyDescription}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button nativeButton={false} render={<Link to="/patients/new" />}>
								{t.common.registerPatient}
							</Button>
						</EmptyContent>
					</Empty>
				) : null}
			</div>
		</div>
	);
}
