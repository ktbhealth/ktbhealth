import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowLeftIcon, KeyRoundIcon } from "lucide-react";

import { Alert, AlertDescription } from "@ktbhealth/ui/components/alert";
import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";
import { Input } from "@ktbhealth/ui/components/input";
import { Label } from "@ktbhealth/ui/components/label";

import { patientAccessMessages, type PatientAccessMessages } from "../i18n.ts";

export interface PatientLinkItem {
	readonly id: number;
	readonly email: string;
	readonly relation: string;
	readonly status: string;
	readonly source: string;
}

type InviteError = keyof PatientAccessMessages["errors"];

/** Server actions the page needs — bound to this plugin's fns by the route. */
export interface PatientAccessApi {
	invite(input: {
		email: string;
		relation: string;
	}): Promise<{ ok: true } | { ok: false; error: InviteError }>;
	approve(id: number): Promise<{ ok: boolean }>;
	revoke(id: number): Promise<{ ok: boolean }>;
}

export function PatientAccessPage({
	patient,
	links,
	locale,
	api,
	onChanged,
}: {
	patient: { readonly id: number; readonly name: string };
	links: readonly PatientLinkItem[];
	/** Active UI locale, injected by the host. */
	locale: string;
	api: PatientAccessApi;
	/** Called after any change — the host refreshes the list. */
	onChanged: () => void;
}) {
	const t = patientAccessMessages(locale);
	const [email, setEmail] = useState("");
	const [relation, setRelation] = useState("self");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<InviteError | null>(null);

	const settle = (ok: boolean, failure: InviteError = "failed") => {
		setPending(false);
		if (!ok) return setError(failure);
		onChanged();
	};

	const invite = async (e: FormEvent) => {
		e.preventDefault();
		if (!email.trim() || pending) return;
		setPending(true);
		setError(null);
		const res = await api
			.invite({ email, relation })
			.catch(() => ({ ok: false as const, error: "failed" as const }));
		if (res.ok) setEmail("");
		settle(res.ok, res.ok ? undefined : res.error);
	};

	const change = async (action: (id: number) => Promise<{ ok: boolean }>, id: number) => {
		setPending(true);
		setError(null);
		const res = await action(id).catch(() => ({ ok: false }));
		settle(res.ok);
	};

	const label = <K extends string>(labels: Record<K, string>, key: string) =>
		labels[key as K] ?? key;

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-6">
			<div>
				<Link
					to="/patients/$id"
					params={{ id: String(patient.id) }}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
				>
					<ArrowLeftIcon className="size-4" />
					{t.back}
				</Link>
				<h1 className="mt-2 text-2xl font-bold tracking-tight">{t.title(patient.name)}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
			</div>
			<form onSubmit={invite} className="flex flex-wrap items-end gap-2">
				<div className="flex min-w-48 flex-1 flex-col gap-1.5">
					<Label htmlFor="access-email">{t.emailLabel}</Label>
					<Input
						id="access-email"
						type="email"
						autoComplete="off"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="access-relation">{t.relationLabel}</Label>
					<select
						id="access-relation"
						value={relation}
						onChange={(e) => setRelation(e.target.value)}
						className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
					>
						<option value="self">{t.relation.self}</option>
						<option value="guardian">{t.relation.guardian}</option>
					</select>
				</div>
				<Button type="submit" disabled={pending}>
					{pending ? t.pending : t.invite}
				</Button>
			</form>
			{error ? (
				<Alert variant="destructive">
					<AlertDescription>{t.errors[error]}</AlertDescription>
				</Alert>
			) : null}
			{links.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<KeyRoundIcon />
						</EmptyMedia>
						<EmptyTitle>{t.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="divide-y divide-border rounded-xl border border-border">
					{links.map((link) => (
						<li key={link.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{link.email}</p>
								<p className="text-xs text-muted-foreground">
									{label(t.relation, link.relation)}
									{link.source === "cpf" ? ` · ${t.cpfMatch}` : ""}
								</p>
							</div>
							<Badge variant={link.status === "active" ? "default" : "secondary"}>
								{label(t.status, link.status)}
							</Badge>
							{link.status === "pending" ? (
								<Button
									size="sm"
									disabled={pending}
									onClick={() => void change(api.approve, link.id)}
								>
									{t.approve}
								</Button>
							) : null}
							<Button
								variant="outline"
								size="sm"
								disabled={pending}
								onClick={() => void change(api.revoke, link.id)}
							>
								{t.revoke}
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
