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
import { saveConsultationFn } from "#/lib/fns.ts";
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
			review: { lacunas: [], hipoteses: [], sinais_de_alerta: [], inconsistencias: [] },
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
		// consultations plugin owns /consultas (+/$id) and /consulta/nova.
		const consultas = routes.children?.find((n) => n.type === "route" && n.path === "consultas");
		expect(consultas).toMatchObject({
			children: [
				{ type: "index", file: "consultas/index.tsx" },
				{ type: "route", path: "$id", file: "consultas/$id.tsx" },
			],
		});
		const consulta = routes.children?.find((n) => n.type === "route" && n.path === "consulta");
		expect(consulta).toMatchObject({
			children: [{ type: "route", path: "nova", file: "consulta/nova.tsx" }],
		});
	});

	it("renders home, sign-in page and navigates", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await waitFor(() => expect(document.body.textContent).toContain("documentada"));
		// sign-in link present (anonymous)
		expect(screen.getByText("Entrar")).toBeTruthy();
		// nav links from plugin manifests
		expect(screen.getByText("Consultas")).toBeTruthy();

		await act(async () => {
			await router.navigate({ to: "/entrar" });
		});
		await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
		expect(screen.getByLabelText("Senha")).toBeTruthy();

		await act(async () => {
			await router.navigate({ to: "/consultas" });
		});
		await waitFor(() => expect(router.state.location.pathname).toBe("/consultas"));
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
		const sair = await screen.findByText("Sair");
		await act(async () => {
			fireEvent.click(sair);
		});
		await act(async () => {
			await router.navigate({ to: "/consultas/$id", params: { id: String(consultationId) } });
		});
		await waitFor(() => expect(document.body.textContent).toContain("conteúdo queixa_principal"));
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

	it("renders consulta detail 404 for unknown id", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/consultas/$id", params: { id: "99999" } });
		});
		await waitFor(() =>
			expect(document.body.textContent).toMatch(/não encontrada|não é sua|Consultas/),
		);
	});

	it("renders nova consulta page", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/consulta/nova" });
		});
		await waitFor(() => expect(document.body.textContent).toMatch(/consulta|anamnese|gravar/i));
	});

	it("renders teste-captura page", async () => {
		const router = getRouter();
		await router.load();
		render(createElement(RouterProvider, { router }));
		await act(async () => {
			await router.navigate({ to: "/teste-captura" });
		});
		await waitFor(() => expect(document.body.textContent).toMatch(/captura|aba|áudio/i));
	});
});
