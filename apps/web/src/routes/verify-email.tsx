import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "@ktb/auth-better/client";
import { Alert, AlertDescription } from "@ktbhealth/ui/components/alert";
import { Button, buttonVariants } from "@ktbhealth/ui/components/button";
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
import { Turnstile } from "@ktbhealth/ui/components/turnstile";
import * as m from "#/paraglide/messages.js";

/** Where the emailed link lands — back here, now showing the verified state. */
const CALLBACK_URL = "/verify-email";

export const Route = createFileRoute("/verify-email")({
	head: () => ({ meta: [{ title: m.verify_meta_title() }] }),
	component: VerifyEmailPage,
});

// Resend screen for the sign-up verification link. Signed-in users
// resend to their own address; anonymous visitors type one. The
// confirmation is the same whether or not the address has an account,
// so the page never reveals which emails are registered.
function VerifyEmailPage() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const [typedEmail, setTypedEmail] = useState("");
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState(false);
	const [pending, setPending] = useState(false);

	const user = session?.user;
	const email = user?.email ?? typedEmail.trim();

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!email || pending) return;
		setPending(true);
		setError(null);
		setSent(false);
		const res = await authClient.sendVerificationEmail({
			email,
			callbackURL: CALLBACK_URL,
			captchaToken: captchaToken ?? undefined,
		} as Parameters<typeof authClient.sendVerificationEmail>[0]);
		setPending(false);
		if (res.error) {
			setError(res.error.message ?? m.verify_error_fallback());
			return;
		}
		setSent(true);
	};

	if (sessionPending) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (user?.emailVerified) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<Card className="w-full max-w-sm">
					<CardHeader>
						<CardTitle>{m.verify_done_heading()}</CardTitle>
						<CardDescription>{m.verify_done_desc({ email: user.email })}</CardDescription>
					</CardHeader>
					<CardContent>
						<Link to="/" className={buttonVariants({ className: "w-full" })}>
							{m.verify_continue()}
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>{m.verify_heading()}</CardTitle>
					<CardDescription>
						{user ? m.verify_desc_signed({ email: user.email }) : m.verify_desc_anon()}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={submit} className="flex flex-col gap-4">
						{user ? null : (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="email">{m.login_email()}</Label>
								<Input
									id="email"
									type="email"
									autoComplete="email"
									required
									value={typedEmail}
									onChange={(e) => setTypedEmail(e.target.value)}
								/>
							</div>
						)}
						<Turnstile onToken={setCaptchaToken} />
						{error ? (
							<Alert variant="destructive">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
						{sent ? (
							<Alert>
								<AlertDescription>{m.verify_sent()}</AlertDescription>
							</Alert>
						) : null}
						<Button type="submit" disabled={pending} className="w-full">
							{pending ? <Spinner /> : null}
							{pending ? m.login_pending() : m.verify_submit()}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
