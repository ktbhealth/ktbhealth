import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "@ktb/auth-better/client";
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
import { Tabs, TabsList, TabsTrigger } from "@ktbhealth/ui/components/tabs";
import { Turnstile } from "@ktbhealth/ui/components/turnstile";

export const Route = createFileRoute("/entrar")({
	head: () => ({ meta: [{ title: "Entrar | KTB Health" }] }),
	component: SignInPage,
});

function SignInPage() {
	const [mode, setMode] = useState<"in" | "up">("in");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!email.trim() || !password || pending) return;
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
			setError(res.error.message ?? "Não foi possível entrar. Tente novamente.");
			return;
		}
		window.location.assign("/");
	};

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>{mode === "in" ? "Entrar" : "Criar conta"}</CardTitle>
					<CardDescription>
						{mode === "in"
							? "Acesse sua conta para continuar."
							: "Crie uma conta para começar a usar."}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs
						value={mode}
						onValueChange={(value) => {
							setMode(value as "in" | "up");
							setError(null);
						}}
						className="mb-4"
					>
						<TabsList className="w-full">
							<TabsTrigger value="in">Entrar</TabsTrigger>
							<TabsTrigger value="up">Criar conta</TabsTrigger>
						</TabsList>
					</Tabs>
					<form onSubmit={submit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="email">Email</Label>
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
							<Label htmlFor="password">Senha</Label>
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
						<Turnstile onToken={setCaptchaToken} />
						{error ? <p className="text-sm text-red-600">{error}</p> : null}
						<Button type="submit" disabled={pending} className="w-full">
							{pending ? "Aguarde…" : mode === "in" ? "Entrar" : "Criar conta"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
