import { createFileRoute } from "@tanstack/react-router";
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
import * as m from "#/paraglide/messages.js";

export const Route = createFileRoute("/login")({
	head: () => ({ meta: [{ title: m.login_meta_title() }] }),
	component: SignInPage,
});

function SignInPage() {
	const [mode, setMode] = useState<"in" | "up">("in");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!email.trim() || !password || pending) return;
		if (mode === "up" && confirmPassword !== password) {
			setError(m.login_error_password_mismatch());
			return;
		}
		setPending(true);
		setError(null);
		const credentials = { email, password, captchaToken: captchaToken ?? undefined };
		/* v8 ignore next -- split() always yields a first element */
		const signUpName = email.split("@")[0] ?? email;
		const res =
			mode === "up"
				? await authClient.signUp.email({
						...credentials,
						name: signUpName,
					} as Parameters<typeof authClient.signUp.email>[0])
				: await authClient.signIn.email(
						credentials as Parameters<typeof authClient.signIn.email>[0],
					);
		setPending(false);
		if (res.error) {
			setError(res.error.message ?? m.login_error_fallback());
			return;
		}
		window.location.assign("/");
	};

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>{mode === "in" ? m.login_heading_in() : m.login_heading_up()}</CardTitle>
					<CardDescription>{mode === "in" ? m.login_desc_in() : m.login_desc_up()}</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs
						value={mode}
						onValueChange={(value) => {
							setMode(value as "in" | "up");
							setConfirmPassword("");
							setError(null);
						}}
						className="mb-4"
					>
						<TabsList className="w-full">
							<TabsTrigger value="in">{m.login_tab_in()}</TabsTrigger>
							<TabsTrigger value="up">{m.login_tab_up()}</TabsTrigger>
						</TabsList>
					</Tabs>
					<form onSubmit={submit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="email">{m.login_email()}</Label>
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
							<Label htmlFor="password">{m.login_password()}</Label>
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
								<Label htmlFor="confirm-password">{m.login_confirm_password()}</Label>
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
						<Button type="submit" disabled={pending} className="w-full">
							{pending ? <Spinner /> : null}
							{pending
								? m.login_pending()
								: mode === "in"
									? m.login_submit_in()
									: m.login_submit_up()}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
