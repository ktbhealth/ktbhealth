import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "@ktb/auth-better/client";
import { Alert, AlertDescription } from "@ktbhealth/ui/components/alert";
import { Button } from "@ktbhealth/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ktbhealth/ui/components/card";
import { Input } from "@ktbhealth/ui/components/input";
import { Label } from "@ktbhealth/ui/components/label";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import { Tabs, TabsList, TabsTrigger } from "@ktbhealth/ui/components/tabs";
import { Turnstile } from "@ktbhealth/ui/components/turnstile";

import { secretaryMessages } from "../i18n.ts";

/**
 * Server calls the page needs — the route binds `context` to the
 * doctors plugin's doctorContextFn, which claims pending invites
 * addressed to the user's verified email before listing profiles.
 */
export interface SecretaryLoginApi {
	context(): Promise<{
		readonly profiles: readonly { readonly doctorId: number }[];
	} | null>;
}

/**
 * Sign-in / create-account page for delegated staff — the screen the
 * invite email points to. Unlike the doctor screen, sign-up never
 * creates a doctor profile: a secretary only gains delegated profiles
 * once their invited email is verified. An account that signs in with
 * no delegation stays here with a hint instead of bouncing to the
 * app home.
 */
export function SecretaryLoginPage({
	locale,
	emailEnabled,
	api,
}: {
	readonly locale: string;
	readonly emailEnabled: boolean;
	readonly api: SecretaryLoginApi;
}) {
	const t = secretaryMessages(locale).login;
	const [mode, setMode] = useState<"in" | "up">("in");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [noDelegation, setNoDelegation] = useState(false);
	const [pending, setPending] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!email.trim() || !password || pending) return;
		if (mode === "up" && confirmPassword !== password) {
			setError(t.errorPasswordMismatch);
			return;
		}
		setPending(true);
		setError(null);
		setNoDelegation(false);
		const credentials = { email, password, captchaToken: captchaToken ?? undefined };
		const res =
			mode === "up"
				? await authClient.signUp.email({
						...credentials,
						name: name.trim(),
						// Where the emailed verification link lands.
						callbackURL: "/verify-email",
					} as Parameters<typeof authClient.signUp.email>[0])
				: await authClient.signIn.email(
						credentials as Parameters<typeof authClient.signIn.email>[0],
					);
		if (res.error) {
			setPending(false);
			setError(res.error.message ?? t.errorFallback);
			return;
		}
		// Signed in: stay pending until the browser navigates away.
		if (mode === "up") {
			// No doctor profile is created here — delegation arrives when
			// the verification email is confirmed and the invite is claimed.
			window.location.assign(emailEnabled ? "/verify-email" : "/doctors/select");
			return;
		}
		const context = await api.context();
		const profiles = context?.profiles.length ?? 0;
		if (profiles === 0) {
			setPending(false);
			setNoDelegation(true);
			return;
		}
		window.location.assign(profiles === 1 ? "/" : "/doctors/select");
	};

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>{mode === "in" ? t.headingIn : t.headingUp}</CardTitle>
					<CardDescription>{mode === "in" ? t.descIn : t.descUp}</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs
						value={mode}
						onValueChange={(value) => {
							setMode(value as "in" | "up");
							setConfirmPassword("");
							setError(null);
							setNoDelegation(false);
						}}
						className="mb-4"
					>
						<TabsList className="w-full">
							<TabsTrigger value="in">{t.tabIn}</TabsTrigger>
							<TabsTrigger value="up">{t.tabUp}</TabsTrigger>
						</TabsList>
					</Tabs>
					<form onSubmit={submit} className="flex flex-col gap-4">
						{mode === "up" ? (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="name">{t.name}</Label>
								<Input
									id="name"
									autoComplete="name"
									required
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</div>
						) : null}
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="email">{t.email}</Label>
							<Input
								id="email"
								type="email"
								autoComplete="email"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="password">{t.password}</Label>
							<Input
								id="password"
								type="password"
								autoComplete={mode === "in" ? "current-password" : "new-password"}
								required
								minLength={8}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</div>
						{mode === "up" ? (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="confirm-password">{t.confirmPassword}</Label>
								<Input
									id="confirm-password"
									type="password"
									autoComplete="new-password"
									required
									minLength={8}
									value={confirmPassword}
									onChange={(e) => setConfirmPassword(e.target.value)}
								/>
							</div>
						) : null}
						<Turnstile onToken={setCaptchaToken} />
						{error ? (
							<Alert variant="destructive">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
						{noDelegation ? (
							<Alert>
								<AlertDescription>{t.noDelegation}</AlertDescription>
							</Alert>
						) : null}
						<Button type="submit" disabled={pending} className="w-full">
							{pending ? <Spinner /> : null}
							{pending ? t.pending : mode === "in" ? t.submitIn : t.submitUp}
						</Button>
					</form>
					<Link
						to="/verify-email"
						className="mt-4 block text-center text-sm text-muted-foreground transition hover:text-foreground"
					>
						{t.verifyLink}
					</Link>
					<Link
						to="/login"
						className="mt-2 block text-center text-sm text-muted-foreground transition hover:text-foreground"
					>
						{t.doctorLink}
					</Link>
				</CardContent>
			</Card>
		</div>
	);
}
