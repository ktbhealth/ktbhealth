import { authClient } from "@ktb/auth-better/client";
import { Avatar, AvatarFallback } from "@ktbhealth/ui/components/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@ktbhealth/ui/components/dropdown-menu";
import { TooltipProvider } from "@ktbhealth/ui/components/tooltip";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { createRootRoute, HeadContent, Link, Scripts } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { SearchXIcon } from "lucide-react";
import { sessionFn } from "#/lib/fns.ts";
import { plugins } from "#/plugins.ts";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	loader: () => sessionFn(),
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "KTB Health" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
	notFoundComponent: () => (
		<div className="py-24 text-center">
			<SearchXIcon className="mx-auto size-12 text-muted-foreground" />
			<h1 className="mt-4 text-2xl font-bold tracking-tight">Página não encontrada</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				O endereço não existe ou a consulta não é sua.
			</p>
			<Link
				to="/consultas"
				className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
			>
				Ir para as consultas
			</Link>
		</div>
	),
});

const NAV_LINK =
	"rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground";
const NAV_ACTIVE = "bg-muted text-foreground";

function RootDocument({ children }: { children: React.ReactNode }) {
	const user = Route.useLoaderData();
	return (
		<html lang="pt-BR">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-background text-foreground antialiased">
				<TooltipProvider>
					<header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
						<nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
							<Link to="/" className="flex items-center gap-2.5">
								<span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-sm">
									K
								</span>
								<span className="text-lg font-bold tracking-tight">KTB Health</span>
							</Link>
							<div className="flex items-center gap-1.5">
								{plugins
									.flatMap((p) => p.nav ?? [])
									.map((item) => (
										<Link
											key={item.to}
											to={item.to}
											className={NAV_LINK}
											activeProps={{ className: `${NAV_LINK} ${NAV_ACTIVE}` }}
										>
											{item.label}
										</Link>
									))}
								<span className="mx-1.5 h-5 w-px bg-border" />
								{!user ? (
									<Link to="/entrar" className={NAV_LINK}>
										Entrar
									</Link>
								) : (
									<DropdownMenu>
										<DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
											<Avatar size="sm">
												<AvatarFallback className="bg-muted text-[11px] font-semibold uppercase">
													{user?.name?.[0] ?? "?"}
												</AvatarFallback>
											</Avatar>
											<span className="max-w-32 truncate">{user?.name}</span>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-52">
											<DropdownMenuGroup>
												<DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
													<span className="text-sm font-medium text-foreground">{user?.name}</span>
													<span className="truncate text-xs text-muted-foreground">
														{user?.email}
													</span>
												</DropdownMenuLabel>
											</DropdownMenuGroup>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												variant="destructive"
												onClick={async () => {
													await authClient.signOut();
													window.location.assign("/");
												}}
											>
												Sair
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								)}
								<Link
									to="/consulta/nova"
									className="ml-1 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/80"
								>
									+ Nova consulta
								</Link>
							</div>
						</nav>
					</header>
					<main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
					<footer className="mx-auto max-w-6xl px-6 pb-8 text-xs text-muted-foreground">
						Prova de conceito: a anamnese é um rascunho e deve ser revisada pelo médico responsável.
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
