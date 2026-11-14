import { useState, type FormEvent } from "react";
import { UserPlusIcon } from "lucide-react";

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

import { secretaryMessages, type SecretaryMessages } from "../i18n.ts";

export interface SecretaryListItem {
	readonly id: number;
	readonly email: string;
	readonly status: string;
}

type InviteError = keyof SecretaryMessages["errors"];

/** Server actions the page needs — bound to this plugin's fns by the route. */
export interface SecretariesApi {
	invite(email: string): Promise<{ ok: true } | { ok: false; error: InviteError }>;
	revoke(id: number): Promise<{ ok: boolean }>;
}

export function SecretariesPage({
	secretaries,
	locale,
	api,
	onChanged,
}: {
	secretaries: readonly SecretaryListItem[];
	/** Active UI locale, injected by the host. */
	locale: string;
	api: SecretariesApi;
	/** Called after an invite or removal — the host refreshes the list. */
	onChanged: () => void;
}) {
	const t = secretaryMessages(locale);
	const [email, setEmail] = useState("");
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
			.invite(email)
			.catch(() => ({ ok: false as const, error: "failed" as const }));
		if (res.ok) setEmail("");
		settle(res.ok, res.ok ? undefined : res.error);
	};

	const revoke = async (id: number) => {
		setPending(true);
		setError(null);
		const res = await api.revoke(id).catch(() => ({ ok: false }));
		settle(res.ok);
	};

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
			</div>
			<form onSubmit={invite} className="flex items-end gap-2">
				<div className="flex flex-1 flex-col gap-1.5">
					<Label htmlFor="secretary-email">{t.emailLabel}</Label>
					<Input
						id="secretary-email"
						type="email"
						autoComplete="off"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
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
			{secretaries.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<UserPlusIcon />
						</EmptyMedia>
						<EmptyTitle>{t.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="divide-y divide-border rounded-xl border border-border">
					{secretaries.map((secretary) => (
						<li key={secretary.id} className="flex items-center gap-3 px-4 py-3">
							<span className="min-w-0 flex-1 truncate text-sm font-medium">{secretary.email}</span>
							<Badge variant={secretary.status === "active" ? "default" : "secondary"}>
								{secretary.status === "active" ? t.status.active : t.status.invited}
							</Badge>
							<Button
								variant="outline"
								size="sm"
								disabled={pending}
								onClick={() => void revoke(secretary.id)}
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
