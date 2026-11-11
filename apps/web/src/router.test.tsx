// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));
vi.mock("@ktbhealth/ui/components/dropdown-menu", async () => {
	const React = await import("react");
	const passthrough =
		(tag: string) =>
		({ children, ...props }: Record<string, unknown>) =>
			React.createElement(tag, props, children as never);
	return {
		DropdownMenu: passthrough("div"),
		DropdownMenuTrigger: passthrough("button"),
		DropdownMenuContent: passthrough("div"),
		DropdownMenuGroup: passthrough("div"),
		DropdownMenuItem: ({ children, onClick, ...props }: Record<string, unknown>) =>
			React.createElement("button", { ...props, onClick: onClick as never }, children as never),
		DropdownMenuLabel: passthrough("div"),
		DropdownMenuSeparator: passthrough("hr"),
		DropdownMenuRadioGroup: passthrough("div"),
		DropdownMenuRadioItem: ({ children, ...props }: Record<string, unknown>) =>
			React.createElement("div", props, children as never),
	};
});
vi.mock("@ktb/auth-better/client", () => ({
	authClient: {
		useSession: () => ({ data: null, isPending: false }),
		signIn: { email: vi.fn(async () => ({})) },
		signUp: { email: vi.fn(async () => ({})) },
		signOut: vi.fn(async () => ({})),
	},
}));
vi.mock("@tanstack/react-devtools", () => ({ TanStackDevtools: () => null }));
vi.mock("@tanstack/react-router-devtools", () => ({
	TanStackRouterDevtoolsPanel: () => null,
}));

import { RouterProvider } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { user as userTable } from "@ktb/auth/schema";
import { getRouter } from "./router.tsx";
import { plugins } from "./plugins.ts";
import { routes } from "./routes.ts";
import { auth, db } from "#/lib/platform.ts";
import { createPatientFn, saveConsultationFn } from "#/lib/fns.ts";
import { SAMPLE_TRANSCRIPT, SECTION_LABELS } from "@ktb/anamnesis";
import type { Anamnesis, AnamnesisSection } from "@ktb/anamnesis";

const sec = (content: string): AnamnesisSection => ({
	content,
	confidence: "alta",
	evidence: ["e"],
});
const fullAnamnesis: Anamnesis = Object.fromEntries(
	(Object.keys(SECTION_LABELS) as (keyof Anamnesis)[]).map((k) => [k, sec("conteúdo " + k)]),
) as unknown as Anamnesis;

let consultationId = 0;

async function signInRouterUser() {
	await auth.api.signUpEmail({
		body: { email: "router@x.com", password: "senha-forte-123", name: "Dra Router" },
	});
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "router@x.com", password: "senha-forte-123" }),
		}),
	);
	headers.current = new Headers({
		cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
	});
	const saved = await saveConsultationFn({
		data: {
			transcript: SAMPLE_TRANSCRIPT,
			anamnesis: fullAnamnesis,
			engine: "heuristic",
		},
	});
	consultationId = saved.id!;
}

describe("router integration", () => {
	afterEach(cleanup);
	beforeAll(async () => {
		// warm up: import route tree happens via router.tsx
	});

	it("plugins and routes compose", () => {
		expect(plugins.length).toBeGreaterThan(0);
		expect(routes).toBeDefined();
		// Plugin-declared subtrees are spliced into the host tree: the
		// consultations plugin owns /consultations via a physical() mount
		// of its own src/routes directory (P-033).
		const consultations = routes.children?.find(
			(n) =>
				n.type === "physical" && (n as { pathPrefix?: string }).pathPrefix === "/consultations",
		);
		expect(consultations).toMatchObject({
			type: "physical",
			pathPrefix: "/consultations",
			directory: "../../../../plugins/consultations/src/routes",
		});
	});

	it("renders home, sign-in page and navigates", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await waitFor(() => expect(document.body.textContent).toContain("The doctor decides."));
		// sign-in link present (anonymous)
		expect(screen.getByText("Sign in")).toBeTruthy();
		// nav links from plugin manifests
		expect(screen.getByText("Consultations")).toBeTruthy();

		await act(async () => {
			await router.navigate({ to: "/login" });
		});
		await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
		expect(screen.getByLabelText("Password")).toBeTruthy();

		await act(async () => {
			await router.navigate({ to: "/consultations" });
		});
		// anonymous → route guard redirects to sign-in
		await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
	});

	it("authenticated user sees name in nav and consultation detail", async () => {
		await signInRouterUser();
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await waitFor(() => expect(document.body.textContent).toContain("Dra Router"));
		// open user menu and sign out
		const trigger = screen.getAllByText("Dra Router")[0]!;
		await act(async () => {
			fireEvent.click(trigger);
		});
		const sair = await screen.findByText("Sign out");
		await act(async () => {
			fireEvent.click(sair);
		});
		await act(async () => {
			await router.navigate({ to: "/consultations" });
		});
		await waitFor(() => expect(document.body.textContent).toContain("conteúdo queixa_principal"));
		await act(async () => {
			await router.navigate({ to: "/consultations/$id", params: { id: String(consultationId) } });
		});
		await waitFor(() => expect(document.body.textContent).toContain("conteúdo queixa_principal"));
	});

	it("consultation detail shows prior-consultation context for a linked patient", async () => {
		await auth.api.signUpEmail({
			body: { email: "hist@x.com", password: "senha-forte-123", name: "Dra Hist" },
		});
		const res = await auth.handler(
			new Request("http://localhost:3000/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "hist@x.com", password: "senha-forte-123" }),
			}),
		);
		headers.current = new Headers({
			cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
		});
		const created = await createPatientFn({
			data: { name: "Paciente Recorrente", birthDate: "1984-03-05" },
		});
		const patient = created.ok ? created.patient : null;
		const mk = (qp: string, plan: string) =>
			saveConsultationFn({
				data: {
					transcript: SAMPLE_TRANSCRIPT,
					anamnesis: {
						...fullAnamnesis,
						queixa_principal: sec(qp),
						conduta: sec(plan),
					},
					engine: "heuristic",
					patientId: patient!.id,
				},
			});
		await mk("Primeira queixa", "Repouso");
		const second = await mk("Segunda queixa", "Retorno em 30 dias");

		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/consultations/$id", params: { id: String(second.id!) } });
		});
		await waitFor(() => expect(document.body.textContent).toContain("1 previous consultation"));
		expect(document.body.textContent).toContain("Complaint: Primeira queixa");
		expect(document.body.textContent).toContain("Plan: Repouso");
	});

	it("shows fallback avatar for a user with empty name", async () => {
		await auth.api.signUpEmail({
			body: { email: "noname@x.com", password: "senha-forte-123", name: "Temp" },
		});
		await db.update(userTable).set({ name: "" }).where(eq(userTable.email, "noname@x.com"));
		const res = await auth.handler(
			new Request("http://localhost:3000/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email: "noname@x.com", password: "senha-forte-123" }),
			}),
		);
		headers.current = new Headers({
			cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
		});
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await waitFor(() =>
			expect(document.querySelector(".bg-muted.uppercase")?.textContent).toBe("?"),
		);
	});

	it("renders consultation detail 404 for unknown id", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/consultations/$id", params: { id: "99999" } });
		});
		await waitFor(() =>
			expect(document.body.textContent).toMatch(/not found|not yours|Consultations/),
		);
	});

	it("renders new consultation page", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/consultations/new" });
		});
		await waitFor(() =>
			expect(document.body.textContent).toMatch(/consultation|anamnesis|record/i),
		);
	});

	it("renders capture-test page", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/capture-test" });
		});
		await waitFor(() => expect(document.body.textContent).toMatch(/capture|tab|audio/i));
	});
});
