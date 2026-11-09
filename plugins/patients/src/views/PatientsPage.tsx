import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";
import { Input } from "@ktbhealth/ui/components/input";
import type { Patient } from "../index.ts";
import { formatCpf } from "../record.ts";
import { demographics, displayName, initials } from "./-format.ts";

export type PatientListItem = Pick<
	Patient,
	"id" | "name" | "socialName" | "gender" | "birthDate" | "cpf" | "cns" | "active"
>;

export function PatientsPage({ patients }: { patients: PatientListItem[] }) {
	const [q, setQ] = useState("");

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
					<h1 className="text-3xl font-bold tracking-tight">Patients</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{patients.length === 0
							? "No patients yet."
							: `${patients.length} patient${patients.length > 1 ? "s" : ""} registered.`}
					</p>
				</div>
				<Button nativeButton={false} render={<Link to="/patients/new" />}>
					<PlusIcon data-icon="inline-start" />
					New patient
				</Button>
			</div>

			{patients.length > 0 ? (
				<div className="relative mt-5 w-full max-w-sm">
					<SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Search by name, CPF, or CNS…"
						aria-label="Search patients"
						className="pl-8"
					/>
				</div>
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
								{[demographics(p), p.cpf ? `CPF ${formatCpf(p.cpf)}` : null]
									.filter(Boolean)
									.join(" · ") || "No demographics recorded"}
							</p>
						</div>
						<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
							{!p.active ? <Badge variant="outline">Inactive</Badge> : null}
							{!p.birthDate ? <Badge variant="outline">Incomplete record</Badge> : null}
						</div>
					</article>
				))}

				{patients.length > 0 && shown.length === 0 ? (
					<Empty className="border">
						<EmptyDescription>No patients match the search.</EmptyDescription>
					</Empty>
				) : null}

				{!patients.length ? (
					<Empty className="border bg-card px-6 py-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<UsersIcon />
							</EmptyMedia>
							<EmptyTitle>No patients yet</EmptyTitle>
							<EmptyDescription>
								Register a patient to link consultations and keep their history together.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button nativeButton={false} render={<Link to="/patients/new" />}>
								Register patient
							</Button>
						</EmptyContent>
					</Empty>
				) : null}
			</div>
		</div>
	);
}
