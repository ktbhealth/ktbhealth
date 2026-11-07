import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { consultations, patients } from "#/db/schema.ts";
import type { Anamnesis } from "#/lib/anamnese/types.ts";
import { getSessionUser } from "#/lib/auth.ts";
import { renderAnamnesisPdf } from "#/lib/pdf.ts";

/** GET /api/consultas/:id/pdf — owner-only download of the anamnese PDF. */
export const Route = createFileRoute("/api/consultas/$id/pdf")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const user = await getSessionUser();
				const id = Number.parseInt(params.id, 10);
				if (!user || !Number.isFinite(id))
					return Response.json({ error: "not found" }, { status: 404 });

				const rows = await db
					.select({ c: consultations, patientName: patients.name })
					.from(consultations)
					.leftJoin(patients, eq(consultations.patientId, patients.id))
					.where(
						and(eq(consultations.id, id), eq(consultations.userId, user.id)),
					)
					.limit(1);
				const row = rows[0];
				if (!row) return Response.json({ error: "not found" }, { status: 404 });
				if (!row.c.anamnesis)
					return Response.json(
						{ error: "consulta sem anamnese salva" },
						{ status: 409 },
					);

				const pdf = await renderAnamnesisPdf({
					consultationId: row.c.id,
					createdAt: row.c.createdAt,
					patientName: row.patientName,
					doctorName: user.isGuest ? null : user.name,
					consentAt: row.c.consentAt,
					anamnesis: JSON.parse(row.c.anamnesis) as Anamnesis,
				});
				return new Response(new Uint8Array(pdf), {
					headers: {
						"content-type": "application/pdf",
						"content-disposition": `attachment; filename="anamnese-consulta-${row.c.id}.pdf"`,
						"cache-control": "private, no-store",
					},
				});
			},
		},
	},
});
