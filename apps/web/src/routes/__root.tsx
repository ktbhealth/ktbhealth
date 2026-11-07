import { TooltipProvider } from "@ktbhealth/ui/components/tooltip";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useState } from "react";
import { ensureUserFn, signInFn } from "#/lib/fns.ts";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	loader: () => ensureUserFn(),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "anamnese" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
	notFoundComponent: () => (
		<div className="py-24 text-center">
			<div className="text-5xl">🔍</div>
			<h1 className="mt-4 text-2xl font-bold tracking-tight">Página não encontrada</h1>
			<p className="mt-1 text-sm text-neutral-500">
				O endereço não existe ou a consulta não é sua.
			</p>
			<Link
				to="/consultas"
				className="mt-6 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
			>
				Ir para as consultas
			</Link>
		</div>
	),
});

const NAV_LINK =
	"rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900";
const NAV_ACTIVE = "bg-neutral-100 text-neutral-900";

function RootDocument({ children }: { children: React.ReactNode }) {
	const user = Route.useLoaderData();
	const [name, setName] = useState("");
	return (
		<html lang="pt-BR">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
				<TooltipProvider>
					<header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur">
						<nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
							<Link to="/" className="flex items-center gap-2.5">
								<span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-sm">
									a
								</span>
								<span className="text-lg font-bold tracking-tight">anamnese</span>
							</Link>
							<div className="flex items-center gap-1.5">
								<Link
									to="/consultas"
									className={NAV_LINK}
									activeProps={{ className: `${NAV_LINK} ${NAV_ACTIVE}` }}
								>
									Consultas
								</Link>
								<span className="mx-1.5 h-5 w-px bg-neutral-200" />
								{user?.isGuest ? (
									<form
										onSubmit={async (e) => {
											e.preventDefault();
											if (!name.trim()) return;
											await signInFn({ data: name });
											location.reload();
										}}
										className="flex items-center gap-1.5"
									>
										<input
											value={name}
											onChange={(e) => setName(e.target.value)}
											placeholder="seu nome"
											aria-label="Seu nome"
											className="w-28 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
										/>
										<button
											type="submit"
											className="rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
										>
											entrar
										</button>
									</form>
								) : (
									<span className="flex items-center gap-2 px-2 text-xs text-neutral-600">
										<span className="flex size-6 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-semibold uppercase">
											{user?.name?.[0] ?? "?"}
										</span>
										{user?.name}
									</span>
								)}
								<Link
									to="/consulta/nova"
									className="ml-1 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-700"
								>
									+ Nova consulta
								</Link>
							</div>
						</nav>
					</header>
					<main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
					<footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-neutral-400">
						Prova de conceito — a anamnese é um rascunho e deve ser revisada pelo médico
						responsável.
					</footer>
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				</TooltipProvider>
				<Scripts />
			</body>
		</html>
	);
}
