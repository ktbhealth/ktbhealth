import { createFileRoute, notFound } from "@tanstack/react-router";

import { SECTION_LABELS } from "#/lib/anamnese/index.ts";
import type { AnamnesisSectionKey } from "#/lib/anamnese/types.ts";
import { getConsultationFn } from "#/lib/fns.ts";

export const Route = createFileRoute("/consultas/$id")({
	loader: async ({ params }) => {
		const c = await getConsultationFn({ data: Number(params.id) });
		if (!c) throw notFound();
		return c;
	},
	component: ConsultaDetail,
});

function ConsultaDetail() {
	const c = Route.useLoaderData();
	return (
		<div className="grid gap-8 lg:grid-cols-2">
			<div>
				<h1 className="text-2xl font-bold">Consulta #{c.id}</h1>
				<p className="mt-1 text-xs text-neutral-400">
					{new Date(c.createdAt).toLocaleString("pt-BR")} · engine:{" "}
					{c.engine ?? "—"}
				</p>
				<h2 className="mt-6 text-sm font-semibold">Transcrição</h2>
				<p className="mt-1 rounded-lg bg-neutral-50 p-4 text-sm leading-relaxed whitespace-pre-wrap text-neutral-700">
					{c.transcript}
				</p>
			</div>
			<div>
				<h2 className="text-sm font-semibold">Anamnese</h2>
				{c.anamnesis ? (
					<div className="mt-2 space-y-4">
						{(Object.keys(SECTION_LABELS) as AnamnesisSectionKey[]).map(
							(key) => (
								<div key={key}>
									<div className="text-xs font-semibold text-neutral-700">
										{SECTION_LABELS[key]}
									</div>
									<p className="mt-0.5 text-sm text-neutral-700">
										{c.anamnesis?.[key].content}
									</p>
								</div>
							),
						)}
					</div>
				) : (
					<p className="mt-2 text-sm text-neutral-400">Sem anamnese salva.</p>
				)}
			</div>
		</div>
	);
}
