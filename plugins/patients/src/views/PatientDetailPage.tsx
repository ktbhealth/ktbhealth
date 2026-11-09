import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	ArrowLeftIcon,
	ClipboardListIcon,
	DownloadIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";

import { Alert } from "@ktbhealth/ui/components/alert";
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
import { Empty, EmptyDescription, EmptyMedia } from "@ktbhealth/ui/components/empty";
import type { Patient } from "../index.ts";
import { patientMessages, type PatientMessages } from "../i18n.ts";
import {
	countryName,
	formatBirthDate,
	formatCns,
	formatCpf,
	formatPostalCode,
	type Language,
	type MaritalStatus,
	type RaceColor,
} from "../record.ts";
import { ageLabel, demographics, displayName, initials } from "./-format.ts";
import { exportLinks } from "./-export.ts";
import { DeletePatientDialog, type PatientDeleteApi } from "./DeletePatientDialog.tsx";

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

function sections(
	p: Patient,
	t: PatientMessages,
	locale: string,
): Array<readonly [title: string, rows: Row[]]> {
	const birth = p.birthDate
		? `${formatBirthDate(p.birthDate)} (${ageLabel(p.birthDate, locale)})`
		: null;
	const f = t.fields;
	return [
		[
			t.sections.identification,
			[
				[f.name, p.name],
				[f.socialName, p.socialName],
				[f.birthDate, birth],
			],
		],
		[
			t.sections.identifiers,
			[
				[f.cpf, p.cpf ? formatCpf(p.cpf) : null],
				[f.cnsShort, p.cns ? formatCns(p.cns) : null],
				[f.passport, p.passport],
			],
		],
		[
			t.sections.contact,
			[
				[f.phone, p.phone],
				[f.email, p.email],
				[
					f.preferredLanguage,
					p.preferredLanguage
						? (t.language[p.preferredLanguage as Language] ?? p.preferredLanguage)
						: null,
				],
			],
		],
		[
			t.sections.address,
			[
				[f.street, joined([joined([p.addressLine, p.addressNumber]), p.addressComplement], " · ")],
				[f.district, p.district],
				[f.city, joined([p.city, p.state], " / ")],
				[f.postalCode, p.postalCode ? formatPostalCode(p.postalCode, p.country) : null],
				[f.country, p.country ? countryName(p.country, locale) : null],
			],
		],
		[
			t.sections.family,
			[
				[f.motherName, p.motherName],
				[
					f.maritalStatus,
					p.maritalStatus ? t.maritalStatus[p.maritalStatus as MaritalStatus] : null,
				],
				[f.raceColorShort, p.raceColor ? t.raceColor[p.raceColor as RaceColor] : null],
				[f.nationality, p.nationality ? countryName(p.nationality, locale) : null],
			],
		],
		[
			t.sections.emergency,
			[
				[f.contactName, joined([p.emergencyContactName, p.emergencyContactRelationship], " · ")],
				[f.phone, p.emergencyContactPhone],
			],
		],
	];
}

export function PatientDetailPage({
	patient,
	consultations,
	locale,
	deleteApi,
	onDeleted,
}: {
	patient: Patient;
	consultations: PatientConsultationItem[];
	/** Active UI locale, injected by the host. */
	locale: string;
	deleteApi: PatientDeleteApi;
	/** Called once the patient (and their consultations) are gone. */
	onDeleted: () => void;
}) {
	const t = patientMessages(locale);
	const [deleting, setDeleting] = useState(false);
	const id = String(patient.id);
	const filled = sections(patient, t, locale)
		.map(([title, rows]) => [title, rows.filter(([, v]) => v)] as const)
		.filter(([, rows]) => rows.length > 0);

	return (
		<div>
			<Button
				variant="ghost"
				size="sm"
				className="-ml-2"
				nativeButton={false}
				render={<Link to="/patients" />}
			>
				<ArrowLeftIcon />
				{t.common.patients}
			</Button>

			<div className="mt-3 flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-4">
					<div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-lg font-semibold text-primary">
						{initials(displayName(patient))}
					</div>
					<div>
						<h1 className="text-3xl font-bold tracking-tight">{displayName(patient)}</h1>
						<p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
							{demographics(patient, locale) || t.common.noDemographics}
							{!patient.active ? <Badge variant="outline">{t.common.inactive}</Badge> : null}
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger render={<Button variant="outline" />}>
							<DownloadIcon data-icon="inline-start" />
							{t.detail.exportRecord}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-56">
							<DropdownMenuGroup>
								<DropdownMenuLabel>{t.detail.exportHeading}</DropdownMenuLabel>
								{exportLinks(t, patient.id).map(({ format, label, href }) => (
									<DropdownMenuItem key={format} render={<a href={href} download />}>
										{label}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						variant="outline"
						nativeButton={false}
						render={<Link to="/patients/$id/edit" params={{ id }} />}
					>
						<PencilIcon data-icon="inline-start" />
						{t.detail.editRecord}
					</Button>
					<Button
						nativeButton={false}
						render={<Link to="/consultations/new" search={{ patientId: patient.id }} />}
					>
						<PlusIcon data-icon="inline-start" />
						{t.detail.newConsultation}
					</Button>
					<Button variant="destructive" onClick={() => setDeleting(true)}>
						<Trash2Icon data-icon="inline-start" />
						{t.actions.delete}
					</Button>
				</div>
			</div>

			{!patient.birthDate ? (
				<Alert className="mt-5 border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
					{t.detail.incomplete}{" "}
					<Link to="/patients/$id/edit" params={{ id }} className="font-medium underline">
						{t.detail.completeRecord}
					</Link>
				</Alert>
			) : null}

			<DeletePatientDialog
				patient={deleting ? { id: patient.id, name: displayName(patient) } : null}
				api={deleteApi}
				t={t}
				onClose={() => setDeleting(false)}
				onDeleted={onDeleted}
			/>

			<div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
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
						{t.detail.consultations}{" "}
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
										{new Date(c.createdAt).toLocaleDateString(locale)}
									</Link>
									<span className="text-xs text-muted-foreground">
										#{c.id}
										{c.status === "live" ? ` · ${t.detail.live}` : ""}
										{c.hasAnamnesis ? "" : ` · ${t.detail.noAnamnesis}`}
									</span>
								</div>
								<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
									{c.chiefComplaint && !c.chiefComplaint.startsWith("A preencher")
										? c.chiefComplaint
										: t.detail.noChiefComplaint}
								</p>
							</article>
						))}
						{consultations.length === 0 ? (
							<Empty className="border px-6 py-10">
								<EmptyMedia variant="icon">
									<ClipboardListIcon />
								</EmptyMedia>
								<EmptyDescription>{t.detail.noConsultations}</EmptyDescription>
							</Empty>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
