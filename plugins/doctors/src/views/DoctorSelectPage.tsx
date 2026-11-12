import { useState } from "react";

import { Alert, AlertDescription } from "@ktbhealth/ui/components/alert";
import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ktbhealth/ui/components/card";

import { doctorMessages } from "../i18n.ts";

export interface DoctorProfileItem {
	readonly doctorId: number;
	readonly displayName: string;
	readonly role: "owner" | "secretary";
}

/** Server actions the chooser needs — bound to this plugin's fns by the route. */
export interface DoctorSelectApi {
	select(doctorId: number): Promise<{ ok: boolean }>;
}

export function DoctorSelectPage({
	profiles,
	activeDoctorId,
	locale,
	api,
	onDone,
}: {
	/** Never empty — the route sends accounts with no doctor profile to
	 * the patient portal. */
	profiles: readonly DoctorProfileItem[];
	/** The profile currently in effect, if any. */
	activeDoctorId: number | null;
	/** Active UI locale, injected by the host. */
	locale: string;
	api: DoctorSelectApi;
	/** Called once a profile is in effect — the host leaves the chooser. */
	onDone: () => void;
}) {
	const t = doctorMessages(locale);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);

	const run = async (action: () => Promise<{ ok: boolean }>) => {
		setPending(true);
		setFailed(false);
		const ok = await action().then(
			(res) => res.ok,
			() => false,
		);
		if (ok) return onDone();
		setPending(false);
		setFailed(true);
	};

	return (
		<div className="mx-auto flex max-w-xl flex-col gap-4">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">{t.selectTitle}</h1>
				<p className="mt-1 text-sm text-muted-foreground">{t.selectDescription}</p>
			</div>
			{failed ? (
				<Alert variant="destructive">
					<AlertDescription>{t.error}</AlertDescription>
				</Alert>
			) : null}
			{profiles.map((profile) => (
				<Card key={profile.doctorId}>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							{profile.displayName}
							{profile.doctorId === activeDoctorId ? <Badge>{t.current}</Badge> : null}
						</CardTitle>
						<CardDescription>
							{profile.role === "owner" ? t.roleOwner : t.roleSecretary}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							variant={profile.doctorId === activeDoctorId ? "outline" : "default"}
							disabled={pending}
							onClick={() => void run(() => api.select(profile.doctorId))}
						>
							{t.choose}
						</Button>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
