import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

import { auth, db } from "#/lib/platform.ts";
import { createConsultation } from "@ktb/consultations";
import { consultations } from "@ktb/db/schema";
import { createPatient } from "@ktb/patients";
import { validatePatient } from "@ktb/patients/record";
import { eq } from "drizzle-orm";
import { Route as PdfRoute } from "./consultations.$id.pdf.ts";

const GET = (
	PdfRoute as unknown as {
		options: { server: { handlers: { GET: (a: never) => Promise<Response> } } };
	}
).options.server.handlers.GET;

const call = (id: number) => GET({ params: { id: String(id) } } as never);

let userId = "";

async function signIn(email: string) {
	await auth.api.signUpEmail({ body: { email, password: "senha-forte-123", name: "Dra PDF" } });
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "senha-forte-123" }),
		}),
	);
	const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
	const sess: any = await auth.api.getSession({ headers: new Headers({ cookie }) });
	return { cookie, userId: sess.user.id as string };
}

const sec = { content: "x", confidence: "alta", evidence: [] };
const ANAMNESIS = JSON.stringify({
	queixa_principal: sec,
	hda: sec,
	antecedentes: sec,
	alergias: sec,
	medicamentos_em_uso: sec,
	exame_fisico: sec,
	hipoteses: sec,
	conduta: sec,
});

const patientFor = async (owner: string) => {
	const fields = validatePatient({ name: "Ana Souza", birthDate: "1984", gender: "female" });
	if (!fields.ok) throw new Error("fixture");
	return (await createPatient(db, owner, fields.fields))!.id;
};

const consultationWith = async (patientId: number | null) => {
	const id = (await createConsultation(db, { userId, source: "mic" }))!;
	await db
		.update(consultations)
		.set({ anamnesis: ANAMNESIS, patientId })
		.where(eq(consultations.id, id));
	return id;
};

beforeAll(async () => {
	const me = await signIn("pdf-edges@x.com");
	userId = me.userId;
	headers.current = new Headers({ cookie: me.cookie });
});

describe("anamnesis pdf with a linked patient", () => {
	it("renders the PDF with the patient's summary when the patient is the owner's", async () => {
		const res = await call(await consultationWith(await patientFor(userId)));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
	});

	it("still renders (without patient details) when the linked patient belongs to someone else", async () => {
		const res = await call(await consultationWith(await patientFor("someone-else")));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
	});

	it("renders for a consultation with no linked patient", async () => {
		const res = await call(await consultationWith(null));
		expect(res.status).toBe(200);
	});
});
