// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSession: vi.fn(async () => undefined),
	getPatientFn: vi.fn(),
	listPatientsFn: vi.fn(),
	patientConsultationsFn: vi.fn(),
	localeFn: vi.fn(async () => "pt-BR"),
	invalidate: vi.fn(),
	navigate: vi.fn(),
	notFound: vi.fn(() => new Error("not-found")),
	loaderData: { current: undefined as unknown },
	props: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("./guard.ts", () => ({ requireSession: mocks.requireSession }));
vi.mock("./fns.ts", () => ({
	getPatientFn: mocks.getPatientFn,
	listPatientsFn: mocks.listPatientsFn,
	patientConsultationsFn: mocks.patientConsultationsFn,
	localeFn: mocks.localeFn,
	createPatientFn: vi.fn(),
	updatePatientFn: vi.fn(),
	deletePatientFn: vi.fn(),
	patientDeletionImpactFn: vi.fn(),
	sessionUserFn: vi.fn(),
}));
vi.mock("./apis.ts", () => ({
	patientDeleteApi: { tag: "delete-api" },
	newPatientApi: { tag: "new-api" },
	editPatientApi: vi.fn((id: number) => ({ tag: `edit-api-${id}` })),
}));
vi.mock("./views/index.ts", () => {
	const capture = (name: string) => (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div", { "data-testid": name });
	};
	return {
		PatientsPage: capture("patients"),
		PatientDetailPage: capture("detail"),
		PatientFormPage: capture("form"),
	};
});
// Server fns become plain async calls; with no runtime registered the
// plugin route gate (createPluginFileRoute → pluginEnabledFn) is inert.
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
		notFound: mocks.notFound,
		useRouter: () => ({ invalidate: mocks.invalidate }),
		useNavigate: () => mocks.navigate,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
		}),
	};
});

import { Route as IndexRoute } from "./routes/index.tsx";
import { Route as NewRoute } from "./routes/new.tsx";
import { Route as DetailRoute } from "./routes/$id/index.tsx";
import { Route as EditRoute } from "./routes/$id/edit.tsx";

type Opts = {
	beforeLoad?: () => Promise<unknown>;
	loader?: (a?: { params: { id: string } }) => Promise<unknown>;
	component: () => ReactElement;
	staleTime?: number;
};
const opts = (route: unknown) => (route as { options: Opts }).options;
const props = () => mocks.props.current!;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.props.current = undefined;
});

describe("patient routes", () => {
	it("guard every page with requireSession", async () => {
		for (const route of [IndexRoute, NewRoute, DetailRoute, EditRoute]) {
			await opts(route).beforeLoad!();
		}
		expect(mocks.requireSession).toHaveBeenCalledTimes(4);
	});

	describe("/patients", () => {
		it("loads the patient list and locale", async () => {
			mocks.listPatientsFn.mockResolvedValue([{ id: 1 }]);
			await expect(opts(IndexRoute).loader!()).resolves.toEqual({
				patients: [{ id: 1 }],
				locale: "pt-BR",
			});
		});

		it("renders the list with locale and delete wiring; deletion invalidates the router", () => {
			mocks.loaderData.current = { patients: [{ id: 1 }], locale: "pt-BR" };
			render(createElement(opts(IndexRoute).component));
			expect(props().patients).toEqual([{ id: 1 }]);
			expect(props().locale).toBe("pt-BR");
			expect(props().deleteApi).toEqual({ tag: "delete-api" });
			(props().onDeleted as () => void)();
			expect(mocks.invalidate).toHaveBeenCalledOnce();
		});
	});

	describe("/patients/new", () => {
		it("loads the active locale for the form", async () => {
			await expect(opts(NewRoute).loader!()).resolves.toBe("pt-BR");
			expect(mocks.localeFn).toHaveBeenCalledOnce();
		});

		it("navigates to the created patient after saving", () => {
			mocks.loaderData.current = "pt-BR";
			render(createElement(opts(NewRoute).component));
			expect(props().api).toEqual({ tag: "new-api" });
			expect(props().locale).toBe("pt-BR");
			(props().onSaved as (id: number) => void)(42);
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: "/patients/$id",
				params: { id: "42" },
			});
		});
	});

	describe("/patients/$id", () => {
		it("caches the loader result for 30s", () => {
			expect(opts(DetailRoute).staleTime).toBe(30_000);
		});

		it("loads the patient with their consultations and locale", async () => {
			mocks.getPatientFn.mockResolvedValue({ id: 5 });
			mocks.patientConsultationsFn.mockResolvedValue([{ id: 9 }]);
			await expect(opts(DetailRoute).loader!({ params: { id: "5" } })).resolves.toEqual({
				patient: { id: 5 },
				consultations: [{ id: 9 }],
				locale: "pt-BR",
			});
			expect(mocks.getPatientFn).toHaveBeenCalledWith({ data: 5 });
			expect(mocks.patientConsultationsFn).toHaveBeenCalledWith({ data: 5 });
		});

		it("throws notFound when the patient does not exist", async () => {
			mocks.getPatientFn.mockResolvedValue(null);
			mocks.patientConsultationsFn.mockResolvedValue([]);
			await expect(opts(DetailRoute).loader!({ params: { id: "5" } })).rejects.toThrow("not-found");
		});

		it("throws notFound for non-numeric ids without calling the fns", async () => {
			for (const id of ["abc", "NaN", "1.5", "-3", ""]) {
				await expect(opts(DetailRoute).loader!({ params: { id } })).rejects.toThrow("not-found");
			}
			expect(mocks.getPatientFn).not.toHaveBeenCalled();
			expect(mocks.patientConsultationsFn).not.toHaveBeenCalled();
		});

		it("renders the detail page; deletion returns to the list", () => {
			mocks.loaderData.current = {
				patient: { id: 5 },
				consultations: [{ id: 9 }],
				locale: "pt-BR",
			};
			render(createElement(opts(DetailRoute).component));
			expect(props().patient).toEqual({ id: 5 });
			expect(props().consultations).toEqual([{ id: 9 }]);
			expect(props().locale).toBe("pt-BR");
			expect(props().deleteApi).toEqual({ tag: "delete-api" });
			(props().onDeleted as () => void)();
			expect(mocks.navigate).toHaveBeenCalledWith({ to: "/patients" });
		});
	});

	describe("/patients/$id/edit", () => {
		it("loads the patient and locale", async () => {
			mocks.getPatientFn.mockResolvedValue({ id: 5 });
			await expect(opts(EditRoute).loader!({ params: { id: "5" } })).resolves.toEqual({
				patient: { id: 5 },
				locale: "pt-BR",
			});
			expect(mocks.getPatientFn).toHaveBeenCalledWith({ data: 5 });
		});

		it("throws notFound when the patient does not exist", async () => {
			mocks.getPatientFn.mockResolvedValue(null);
			await expect(opts(EditRoute).loader!({ params: { id: "5" } })).rejects.toThrow("not-found");
		});

		it("throws notFound for non-numeric ids without calling the fns", async () => {
			for (const id of ["abc", "NaN", "1.5", "-3", ""]) {
				await expect(opts(EditRoute).loader!({ params: { id } })).rejects.toThrow("not-found");
			}
			expect(mocks.getPatientFn).not.toHaveBeenCalled();
		});

		it("renders the form for the loaded patient and navigates after saving", () => {
			mocks.loaderData.current = { patient: { id: 5, name: "Ana" }, locale: "pt-BR" };
			render(createElement(opts(EditRoute).component));
			expect(props().patient).toEqual({ id: 5, name: "Ana" });
			expect(props().api).toEqual({ tag: "edit-api-5" });
			expect(props().locale).toBe("pt-BR");
			(props().onSaved as (id: number) => void)(5);
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: "/patients/$id",
				params: { id: "5" },
			});
		});
	});
});
