import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import type { AnamnesisSectionKey } from "@ktb/anamnesis/types";

import { portalMessages } from "../i18n.ts";

export interface PortalConsultationView {
	readonly id: number;
	readonly createdAt: Date;
	readonly patientName: string;
	readonly doctorName: string | null;
	/** The sections the doctor filled in, in document order. */
	readonly sections: readonly {
		readonly key: AnamnesisSectionKey;
		readonly content: string;
	}[];
}

/** One consultation as the patient sees it: the record the doctor
 * saved, read-only — no actions beyond going back to the list. */
export function PortalConsultationPage({
	consultation,
	locale,
}: {
	consultation: PortalConsultationView;
	/** Active UI locale, injected by the host. */
	locale: string;
}) {
	const t = portalMessages(locale);
	const when = new Date(consultation.createdAt).toLocaleString(locale, {
		dateStyle: "long",
		timeStyle: "short",
	});
	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-6">
			<div>
				<Link
					to="/portal"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
				>
					<ArrowLeftIcon className="size-4" />
					{t.back}
				</Link>
				<h1 className="mt-2 text-2xl font-bold tracking-tight">{t.consultationTitle}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{when}</p>
				<dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
					<dt className="text-muted-foreground">{t.patient}</dt>
					<dd>{consultation.patientName}</dd>
					{consultation.doctorName ? (
						<>
							<dt className="text-muted-foreground">{t.doctor}</dt>
							<dd>{consultation.doctorName}</dd>
						</>
					) : null}
				</dl>
			</div>
			{consultation.sections.length === 0 ? (
				<p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
					{t.sectionsEmpty}
				</p>
			) : (
				<div className="flex flex-col gap-3">
					{consultation.sections.map((section) => (
						<section key={section.key} className="rounded-xl border border-border bg-card p-4">
							<h2 className="text-sm font-semibold">{t.sections[section.key]}</h2>
							<p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{section.content}</p>
						</section>
					))}
				</div>
			)}
			<p className="text-xs text-muted-foreground">{t.readOnlyNote}</p>
		</div>
	);
}
