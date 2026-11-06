import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "anamnese" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="pt-BR">
			<head>
				<HeadContent />
			</head>
			<body>
				<header className="border-b border-neutral-200">
					<nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
						<Link to="/" className="text-lg font-bold tracking-tight">
							anamnese
						</Link>
						<div className="flex items-center gap-5 text-sm text-neutral-600">
							<Link to="/consultas" className="hover:text-neutral-900">
								Consultas
							</Link>
							<Link
								to="/consulta/nova"
								className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
							>
								+ Nova consulta
							</Link>
						</div>
					</nav>
				</header>
				<main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
				<TanStackDevtools
					config={{ position: "bottom-right" }}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
