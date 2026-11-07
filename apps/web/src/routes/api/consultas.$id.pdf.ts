import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { Consultations } from "@ktb/consultations";
import { getSessionUser } from "#/lib/auth.ts";
import { run } from "#/lib/platform.ts";
import { renderAnamnesisPdf } from "@ktb/export-pdf";

/** GET /api/consultas/:id/pdf — owner-only download of the anamnese PDF. */
export const Route = createFileRoute("/api/consultas/$id/pdf")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const user = await getSessionUser();
				const id = Number.parseInt(params.id, 10);
				if (!user || !Number.isFinite(id))
					return Response.json({ error: "not found" }, { status: 404 });

				const detail = await run(
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						return yield* consultations.get(id, user.id);
					}),
				);
				if (!detail) return Response.json({ error: "not found" }, { status: 404 });
				if (!detail.anamnesis)
					return Response.json({ error: "consulta sem anamnese salva" }, { status: 409 });

				const pdf = await renderAnamnesisPdf({
					consultationId: detail.id,
					createdAt: detail.createdAt,
					patientName: detail.patientName,
					doctorName: user.name,
					consentAt: detail.consentAt,
					anamnesis: detail.anamnesis,
				});
				return new Response(new Uint8Array(pdf), {
					headers: {
						"content-type": "application/pdf",
						"content-disposition": `attachment; filename="anamnese-consulta-${detail.id}.pdf"`,
						"cache-control": "private, no-store",
					},
				});
			},
		},
	},
});
