import { createFileRoute, Link } from "@tanstack/react-router";

import { listConsultationsFn } from "#/lib/fns.ts";

export const Route = createFileRoute("/consultas/")({
	loader: () => listConsultationsFn(),
	component: ConsultasPage,
});

function ConsultasPage() {
	const consultas = Route.useLoaderData();
	return (
		<div>
			<h1 className="text-3xl font-bold">Consultas</h1>
			<div className="mt-6 divide-y divide-neutral-200 rounded-xl border border-neutral-200">
				{consultas.map((c) => (
					<Link
						key={c.id}
						to="/consultas/$id"
						params={{ id: String(c.id) }}
						className="block px-4 py-3 text-sm hover:bg-neutral-50"
					>
						<div className="flex items-center justify-between">
							<span className="font-medium">Consulta #{c.id}</span>
							<span className="text-xs text-neutral-400">
								{new Date(c.createdAt).toLocaleString("pt-BR")}
							</span>
						</div>
						<p className="mt-1 truncate text-xs text-neutral-500">
							{c.transcript}
						</p>
					</Link>
				))}
				{!consultas.length ? (
					<p className="px-4 py-6 text-sm text-neutral-500">
						Nenhuma consulta ainda —{" "}
						<Link to="/consulta/nova" className="underline">
							inicie uma
						</Link>
						.
					</p>
				) : null}
			</div>
		</div>
	);
}
