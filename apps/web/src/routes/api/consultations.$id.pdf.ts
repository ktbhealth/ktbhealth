import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { Consultations } from "@ktb/consultations";
import { getSessionUser } from "#/lib/auth.ts";
import { runAs } from "#/lib/platform.ts";
import { renderAnamnesisPdf } from "@ktb/export-pdf";

/** GET /api/consultations/:id/pdf — owner-only download of the anamnesis PDF. */
export const Route = createFileRoute("/api/consultations/$id/pdf")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const user = await getSessionUser();
				const id = Number.parseInt(params.id, 10);
				if (!user || !Number.isFinite(id))
					return Response.json({ error: "not found" }, { status: 404 });

				// Non-owner → service fails Forbidden → same 404 as missing.
				const detail = await runAs(
					user,
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						return yield* consultations
							.get(id, user.id)
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
					}),
				);
				if (!detail) return Response.json({ error: "not found" }, { status: 404 });
				if (!detail.anamnesis)
					return Response.json({ error: "consultation has no saved anamnesis" }, { status: 409 });

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
						"content-disposition": `attachment; filename="anamnesis-consultation-${detail.id}.pdf"`,
						"cache-control": "private, no-store",
					},
				});
			},
		},
	},
});
