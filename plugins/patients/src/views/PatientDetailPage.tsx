import { Link } from "@tanstack/react-router";
import { ClipboardListIcon, PencilIcon } from "lucide-react";

import { Alert } from "@ktbhealth/ui/components/alert";
import { Badge } from "@ktbhealth/ui/components/badge";
import { buttonVariants } from "@ktbhealth/ui/components/button";
import { Empty, EmptyDescription, EmptyMedia } from "@ktbhealth/ui/components/empty";
import type { Patient } from "../index.ts";
import {
	countryName,
	formatBirthDate,
	formatCns,
	formatCpf,
	formatPostalCode,
	LANGUAGE_LABELS,
	MARITAL_STATUS_LABELS,
	RACE_COLOR_LABELS,
	type Language,
	type MaritalStatus,
	type RaceColor,
} from "../record.ts";
import { ageLabel, demographics, displayName, initials } from "./-format.ts";

/** The slice of a consultation summary the record page lists. */
export interface PatientConsultationItem {
	readonly id: number;
	readonly createdAt: Date;
	readonly status: string;
	readonly hasAnamnesis: boolean;
	readonly chiefComplaint: string | null;
}

type Row = readonly [label: string, value: string | null];

const joined = (parts: Array<string | null>, sep = ", ") => parts.filter(Boolean).join(sep) || null;

function sections(p: Patient): Array<readonly [title: string, rows: Row[]]> {
	const birth = p.birthDate ? `${formatBirthDate(p.birthDate)} (${ageLabel(p.birthDate)})` : null;
	return [
		[
			"Identification",
			[
				["Full name", p.name],
				["Social name", p.socialName],
				["Birth date", birth],
			],
		],
		[
			"Identifiers",
			[
				["CPF", p.cpf ? formatCpf(p.cpf) : null],
				["CNS", p.cns ? formatCns(p.cns) : null],
				["Passport / foreign ID", p.passport],
			],
		],
		[
			"Contact",
			[
				["Phone", p.phone],
				["Email", p.email],
				[
					"Preferred language",
					p.preferredLanguage
						? (LANGUAGE_LABELS[p.preferredLanguage as Language] ?? p.preferredLanguage)
						: null,
				],
			],
		],
		[
			"Address",
			[
				["Street", joined([joined([p.addressLine, p.addressNumber]), p.addressComplement], " · ")],
				["District", p.district],
				["City", joined([p.city, p.state], " / ")],
				["Postal code", p.postalCode ? formatPostalCode(p.postalCode, p.country) : null],
				["Country", p.country ? countryName(p.country) : null],
			],
		],
		[
			"Family and demographics",
			[
				["Mother's name", p.motherName],
				[
					"Marital status",
					p.maritalStatus ? MARITAL_STATUS_LABELS[p.maritalStatus as MaritalStatus] : null,
				],
				["Race / color", p.raceColor ? RACE_COLOR_LABELS[p.raceColor as RaceColor] : null],
				["Nationality", p.nationality ? countryName(p.nationality) : null],
			],
		],
		[
			"Emergency contact",
			[
				["Name", joined([p.emergencyContactName, p.emergencyContactRelationship], " · ")],
				["Phone", p.emergencyContactPhone],
			],
		],
	];
}

export function PatientDetailPage({
	patient,
	consultations,
}: {
	patient: Patient;
	consultations: PatientConsultationItem[];
}) {
	const id = String(patient.id);
	const filled = sections(patient)
		.map(([title, rows]) => [title, rows.filter(([, v]) => v)] as const)
		.filter(([, rows]) => rows.length > 0);

	return (
		<div>
			<Link to="/patients" className="text-sm text-muted-foreground hover:text-foreground">
				← Patients
			</Link>

			<div className="mt-3 flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-4">
					<div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-lg font-semibold text-primary">
						{initials(displayName(patient))}
					</div>
					<div>
						<h1 className="text-3xl font-bold tracking-tight">{displayName(patient)}</h1>
						<p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							{demographics(patient) || "No demographics recorded"}
							{!patient.active ? <Badge variant="outline">Inactive</Badge> : null}
						</p>
					</div>
				</div>
				<div className="flex gap-2">
					<Link
						to="/patients/$id/edit"
						params={{ id }}
						className={buttonVariants({ variant: "outline" })}
					>
						<PencilIcon className="mr-1 inline size-3.5 -translate-y-px" />
						Edit record
					</Link>
					<Link
						to="/consultations/new"
						search={{ patientId: patient.id }}
						className={buttonVariants()}
					>
						+ New consultation
					</Link>
				</div>
			</div>

			{!patient.birthDate ? (
				<Alert className="mt-6 border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
					This record is incomplete: birth date is missing.{" "}
					<Link to="/patients/$id/edit" params={{ id }} className="font-medium underline">
						Complete the record
					</Link>
				</Alert>
			) : null}

			<div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
				<section className="space-y-4">
					{filled.map(([title, rows]) => (
						<div key={title} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
							<h2 className="text-sm font-semibold">{title}</h2>
							<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
								{rows.map(([label, value]) => (
									<div key={label} className="contents">
										<dt className="text-muted-foreground">{label}</dt>
										<dd>{value}</dd>
									</div>
								))}
							</dl>
						</div>
					))}
				</section>

				<section>
					<h2 className="text-lg font-semibold">
						Consultations{" "}
						<span className="text-sm font-normal text-muted-foreground">
							({consultations.length})
						</span>
					</h2>
					<div className="mt-3 space-y-2">
						{consultations.map((c) => (
							<article
								key={c.id}
								className="relative rounded-xl border border-border bg-card p-3 shadow-sm transition hover:border-foreground/20"
							>
								<div className="flex items-baseline justify-between gap-2">
									<Link
										to="/consultations/$id"
										params={{ id: String(c.id) }}
										className="text-sm font-medium after:absolute after:inset-0 after:content-['']"
									>
										{new Date(c.createdAt).toLocaleDateString()}
									</Link>
									<span className="text-xs text-muted-foreground">
										#{c.id}
										{c.status === "live" ? " · live" : ""}
										{c.hasAnamnesis ? "" : " · no anamnesis"}
									</span>
								</div>
								<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
									{c.chiefComplaint && !c.chiefComplaint.startsWith("A preencher")
										? c.chiefComplaint
										: "No chief complaint recorded."}
								</p>
							</article>
						))}
						{consultations.length === 0 ? (
							<Empty className="border px-6 py-10">
								<EmptyMedia variant="icon">
									<ClipboardListIcon />
								</EmptyMedia>
								<EmptyDescription>No consultations for this patient yet.</EmptyDescription>
							</Empty>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
