import { describe, expect, it, vi } from "vitest";

const localeFn = vi.hoisted(() => vi.fn(async () => "pt-BR"));

vi.mock("../fns.ts", () => ({ localeFn }));
vi.mock("../guard.ts", () => ({ requireSession: vi.fn() }));
vi.mock("../apis.ts", () => ({ newPatientApi: {} }));
vi.mock("../views/index.ts", () => ({ PatientFormPage: () => null }));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((value: unknown) => unknown) | undefined;
		const api = {
			validator: (fn: (value: unknown) => unknown) => {
				validate = fn;
				return api;
			},
			handler: (h: (arg: { data: unknown }) => unknown) => async (call: { data?: unknown }) =>
				h({ data: validate === undefined ? call?.data : validate(call?.data) }),
		};
		return api;
	},
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useNavigate: () => vi.fn(),
		createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
	};
});

import { Route } from "./new.tsx";

describe("/patients/new loader", () => {
	it("attaches the active locale to the route data", async () => {
		const { loader } = (Route as unknown as { options: { loader: () => Promise<string> } }).options;
		await expect(loader()).resolves.toBe("pt-BR");
		expect(localeFn).toHaveBeenCalledOnce();
	});
});
