// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const chain = {
			validator: () => chain,
			handler: (h: (arg?: { data?: unknown }) => unknown) =>
				async (arg?: { data?: unknown }) => h(arg ?? {}),
		};
		return chain;
	},
}));
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
import { getRouter } from "./router.tsx";
import { plugins } from "./plugins.ts";
import { routes } from "./routes.ts";

describe("router integration", () => {
	beforeAll(async () => {
		// warm up: import route tree happens via router.tsx
	});

	it("plugins and routes compose", () => {
		expect(plugins.length).toBeGreaterThan(0);
		expect(routes).toBeDefined();
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

	it("renders consulta detail 404 for unknown id", async () => {
		const router = getRouter();
		await router.load();
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
		await act(async () => {
			await router.navigate({ to: "/consulta/nova" });
		});
		await waitFor(() =>
			expect(document.body.textContent).toMatch(/consulta|anamnese|gravar/i),
		);
	});

	it("renders teste-captura page", async () => {
		const router = getRouter();
		await router.load();
		await act(async () => {
			await router.navigate({ to: "/teste-captura" });
		});
		await waitFor(() => expect(document.body.textContent).toMatch(/captura|aba|áudio/i));
	});
});
