import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

// Sessions may carry no display name; the export then names the practitioner by email.
const session = { dropName: false };
vi.mock("#/lib/auth.ts", async (importOriginal) => {
	const m = await importOriginal<typeof import("#/lib/auth.ts")>();
	return {
		...m,
		getSessionUser: async (h?: Headers) => {
			const user = await m.getSessionUser(h);
			return user && session.dropName ? { ...user, name: null } : user;
		},
	};
});

import { auth, db } from "#/lib/platform.ts";
import { createConsultation } from "@ktb/consultations";
import { consultations } from "@ktb/db/schema";
import { createPatient } from "@ktb/patients";
import { validatePatient } from "@ktb/patients/record";
import { eq } from "drizzle-orm";
import { Route as ExportRoute } from "./patients.$id.export.ts";

const GET = (
	ExportRoute as unknown as {
		options: { server: { handlers: { GET: (a: never) => Promise<Response> } } };
	}
).options.server.handlers.GET;

const call = (id: string, format: string | null) =>
	GET({
		params: { id },
		request: new Request(
			`http://localhost:3000/api/patients/${id}/export${format ? `?format=${format}` : ""}`,
		),
	} as never);

async function signIn(email: string) {
	await auth.api.signUpEmail({ body: { email, password: "senha-forte-123", name: "Dra Export" } });
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "senha-forte-123" }),
		}),
	);
	const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
	const session: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	return { cookie, userId: session.user.id as string };
}

const sec = (content: string) => ({ content, confidence: "alta", evidence: [] });

describe("patient export route", () => {
	let owner: { cookie: string; userId: string };
	let patientId = 0;

	beforeAll(async () => {
		owner = await signIn("export@x.com");
		headers.current = new Headers({ cookie: owner.cookie });
		const fields = validatePatient({ name: "Ana Souza", birthDate: "1984", gender: "female" });
		if (!fields.ok) throw new Error("fixture");
		patientId = (await createPatient(db, owner.userId, fields.fields))!.id;
		// Two consultations, inserted newest-first: the export orders them oldest-first.
		for (const [at, complaint] of [
			["2026-11-06T10:00:00Z", "Retorno"],
			["2026-11-05T10:00:00Z", "Cefaleia"],
		] as const) {
			const id = await createConsultation(db, { userId: owner.userId, source: "browser" });
			await db
				.update(consultations)
				.set({
					patientId,
					createdAt: new Date(at),
					transcript: `Transcrição: ${complaint}`,
					engine: "heuristic",
					anamnesis: JSON.stringify({
						queixa_principal: sec(complaint),
						hda: sec("x"),
						antecedentes: sec(""),
						alergias: sec(""),
						medicamentos_em_uso: sec(""),
						exame_fisico: sec(""),
						hipoteses: sec(""),
						conduta: sec(""),
					}),
				})
				.where(eq(consultations.id, id!));
		}
	});

	it("rejects a missing or unknown format", async () => {
		expect((await call(String(patientId), null)).status).toBe(400);
		expect((await call(String(patientId), "hl7v2")).status).toBe(400);
	});

	it("answers 404 for anonymous callers, bad ids, missing and foreign patients", async () => {
		headers.current = new Headers();
		expect((await call(String(patientId), "fhir-r4")).status).toBe(404);
		headers.current = new Headers({ cookie: owner.cookie });
		expect((await call("abc", "fhir-r4")).status).toBe(404);
		expect((await call("99999", "fhir-r4")).status).toBe(404);

		const other = await signIn("export-other@x.com");
		headers.current = new Headers({ cookie: other.cookie });
		expect((await call(String(patientId), "openehr")).status).toBe(404);
		headers.current = new Headers({ cookie: owner.cookie });
	});

	it("downloads the record as a FHIR R4 Bundle", async () => {
		const res = await call(String(patientId), "fhir-r4");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/fhir+json; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="patient-${patientId}.fhir-r4.json"`,
		);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const bundle: any = await res.json();
		expect(bundle.resourceType).toBe("Bundle");
		const types = bundle.entry.map((e: any) => e.resource.resourceType);
		expect(types.filter((t: string) => t === "Composition")).toHaveLength(2);
		const complaints = bundle.entry
			.filter((e: any) => e.resource.resourceType === "Composition")
			.map((e: any) => e.resource.section[0].text.div);
		expect(complaints[0]).toContain("Cefaleia");
		expect(complaints[1]).toContain("Retorno");
		const practitioner = bundle.entry.find((e: any) => e.resource.resourceType === "Practitioner");
		expect(practitioner.resource.name).toEqual([{ text: "Dra Export" }]);
	});

	it("names an unnamed practitioner by email", async () => {
		session.dropName = true;
		const bundle: any = await (await call(String(patientId), "fhir-r4")).json();
		session.dropName = false;
		const practitioner = bundle.entry.find((e: any) => e.resource.resourceType === "Practitioner");
		expect(practitioner.resource.name).toEqual([{ text: "export@x.com" }]);
	});

	it("downloads the record as an openEHR EXTRACT", async () => {
		const res = await call(String(patientId), "openehr");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="patient-${patientId}.openehr.json"`,
		);
		const extract: any = await res.json();
		expect(extract._type).toBe("EXTRACT");
		const kinds = extract.chapters[0].items.map((i: any) => i.item._type);
		expect(kinds).toEqual([
			"X_VERSIONED_PARTY",
			"X_VERSIONED_EHR_STATUS",
			"X_VERSIONED_COMPOSITION",
			"X_VERSIONED_COMPOSITION",
		]);
	});
});
