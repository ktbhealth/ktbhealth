import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardListIcon, FileHeartIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@ktbhealth/ui/components/alert";
import { Badge } from "@ktbhealth/ui/components/badge";
import { Button, buttonVariants } from "@ktbhealth/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";

import { portalMessages, type PortalMessages } from "../i18n.ts";

export interface PortalProfileItem {
	readonly patientId: number;
	readonly name: string;
	readonly relation: "self" | "guardian";
}

/** The record currently open: whose it is and who keeps it. */
export interface PortalRecord {
	readonly patientId: number;
	readonly name: string;
	readonly doctorName: string | null;
}

export interface PortalConsultationItem {
	readonly id: number;
	readonly createdAt: Date;
	readonly chiefComplaint: string | null;
}

type PortalError = keyof PortalMessages["errors"];

/** Server actions the portal needs — bound to this plugin's fns by the route. */
export interface PortalApi {
	select(patientId: number): Promise<{ ok: boolean }>;
}

export function PortalPage({
	user,
	awaitingInvites,
	profiles,
	profile,
	consultations,
	locale,
	api,
	onChanged,
}: {
	user: { readonly name: string | null; readonly email: string };
	/** Invites for this email still waiting on email verification — the
	 * reason a portal can look empty right after sign-up. */
	awaitingInvites: number;
	profiles: readonly PortalProfileItem[];
	/** The record currently open, if any. */
	profile: PortalRecord | null;
	/** Consultations of the open record, newest first — read-only. */
	consultations: readonly PortalConsultationItem[];
	/** Active UI locale, injected by the host. */
	locale: string;
	api: PortalApi;
	/** Called after a profile switch — the host reloads the data. */
	onChanged: () => void;
}) {
	const t = portalMessages(locale);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<PortalError | null>(null);

	const settle = (ok: boolean, failure: PortalError = "failed") => {
		setPending(false);
		if (!ok) return setError(failure);
		onChanged();
	};

	const select = async (patientId: number) => {
		setPending(true);
		setError(null);
		const res = await api.select(patientId).catch(() => ({ ok: false }));
		settle(res.ok);
	};

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{t.greeting(user.name ?? user.email)}</p>
			</div>
			{error ? (
				<Alert variant="destructive">
					<AlertDescription>{t.errors[error]}</AlertDescription>
				</Alert>
			) : null}
			{awaitingInvites > 0 ? (
				<Alert>
					<AlertTitle>{t.verifyEmailTitle}</AlertTitle>
					<AlertDescription>
						{t.verifyEmailDescription}{" "}
						<Link to="/verify-email" className="font-medium underline underline-offset-4">
							{t.verifyEmailAction}
						</Link>
					</AlertDescription>
				</Alert>
			) : null}
			{profiles.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<FileHeartIcon />
						</EmptyMedia>
						<EmptyTitle>{t.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}
			{profiles.length > 1 ? (
				<section className="flex flex-col gap-2">
					<h2 className="text-sm font-semibold">{t.profilesTitle}</h2>
					<ul className="divide-y divide-border rounded-xl border border-border">
						{profiles.map((item) => (
							<li key={item.patientId} className="flex items-center gap-3 px-4 py-3">
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{item.name}</p>
									<p className="text-xs text-muted-foreground">{t.relation[item.relation]}</p>
								</div>
								{item.patientId === profile?.patientId ? (
									<Badge>{t.current}</Badge>
								) : (
									<Button
										variant="outline"
										size="sm"
										disabled={pending}
										onClick={() => void select(item.patientId)}
									>
										{t.open}
									</Button>
								)}
							</li>
						))}
					</ul>
					{profile ? null : <p className="text-sm text-muted-foreground">{t.chooseHint}</p>}
				</section>
			) : null}
			{profile ? (
				<section className="flex flex-col gap-3">
					<div>
						<h2 className="text-lg font-semibold tracking-tight">{profile.name}</h2>
						<p className="text-sm text-muted-foreground">
							{profile.doctorName
								? `${t.consultationsTitle} · ${t.doctor}: ${profile.doctorName}`
								: t.consultationsTitle}
						</p>
					</div>
					{consultations.length === 0 ? (
						<Empty className="border">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<ClipboardListIcon />
								</EmptyMedia>
								<EmptyTitle>{t.consultationsEmptyTitle}</EmptyTitle>
								<EmptyDescription>{t.consultationsEmptyDescription}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<ul className="divide-y divide-border rounded-xl border border-border">
							{consultations.map((consultation) => (
								<li key={consultation.id} className="flex items-center gap-3 px-4 py-3">
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">
											{new Date(consultation.createdAt).toLocaleDateString(locale, {
												dateStyle: "long",
											})}
										</p>
										<p className="line-clamp-2 text-sm text-muted-foreground">
											{consultation.chiefComplaint ?? t.consultationUntitled}
										</p>
									</div>
									<Link
										to="/portal/consultations/$id"
										params={{ id: String(consultation.id) }}
										className={buttonVariants({ variant: "outline", size: "sm" })}
									>
										{t.viewConsultation}
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>
			) : null}
		</div>
	);
}
