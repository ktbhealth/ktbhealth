// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireSession: vi.fn(async () => undefined),
	getPatientFn: vi.fn(),
	listPatientsFn: vi.fn(),
	listPatientConsultationsFn: vi.fn(),
	invalidate: vi.fn(),
	navigate: vi.fn(),
	notFound: vi.fn(() => new Error("not-found")),
	loaderData: { current: undefined as unknown },
	props: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("#/lib/guard.ts", () => ({ requireSession: mocks.requireSession }));
vi.mock("#/lib/fns.ts", () => ({
	getPatientFn: mocks.getPatientFn,
	listPatientsFn: mocks.listPatientsFn,
	listPatientConsultationsFn: mocks.listPatientConsultationsFn,
	createPatientFn: vi.fn(),
	updatePatientFn: vi.fn(),
}));
vi.mock("#/paraglide/runtime.js", () => ({ getLocale: () => "pt-BR" }));
vi.mock("./-delete-api.ts", () => ({ patientDeleteApi: { tag: "delete-api" } }));
vi.mock("@ktb/patients/views", () => {
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

import { Route as IndexRoute } from "./index.tsx";
import { Route as NewRoute } from "./new.tsx";
import { Route as DetailRoute } from "./$id.tsx";
import { Route as EditRoute } from "./$id.edit.tsx";

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
		it("loads the patient list", async () => {
			mocks.listPatientsFn.mockResolvedValue([{ id: 1 }]);
			await expect(opts(IndexRoute).loader!()).resolves.toEqual([{ id: 1 }]);
		});

		it("renders the list with locale and delete wiring; deletion invalidates the router", () => {
			mocks.loaderData.current = [{ id: 1 }];
			render(createElement(opts(IndexRoute).component));
			expect(props().patients).toEqual([{ id: 1 }]);
			expect(props().locale).toBe("pt-BR");
			expect(props().deleteApi).toEqual({ tag: "delete-api" });
			(props().onDeleted as () => void)();
			expect(mocks.invalidate).toHaveBeenCalledOnce();
		});
	});

	describe("/patients/new", () => {
		it("navigates to the created patient after saving", () => {
			render(createElement(opts(NewRoute).component));
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

		it("loads the patient with their consultations", async () => {
			mocks.getPatientFn.mockResolvedValue({ id: 5 });
			mocks.listPatientConsultationsFn.mockResolvedValue([{ id: 9 }]);
			await expect(opts(DetailRoute).loader!({ params: { id: "5" } })).resolves.toEqual({
				patient: { id: 5 },
				consultations: [{ id: 9 }],
			});
			expect(mocks.getPatientFn).toHaveBeenCalledWith({ data: 5 });
			expect(mocks.listPatientConsultationsFn).toHaveBeenCalledWith({ data: 5 });
		});

		it("throws notFound when the patient does not exist", async () => {
			mocks.getPatientFn.mockResolvedValue(null);
			mocks.listPatientConsultationsFn.mockResolvedValue([]);
			await expect(opts(DetailRoute).loader!({ params: { id: "5" } })).rejects.toThrow("not-found");
		});

		it("renders the detail page; deletion returns to the list", () => {
			mocks.loaderData.current = { patient: { id: 5 }, consultations: [{ id: 9 }] };
			render(createElement(opts(DetailRoute).component));
			expect(props().patient).toEqual({ id: 5 });
			expect(props().consultations).toEqual([{ id: 9 }]);
			expect(props().deleteApi).toEqual({ tag: "delete-api" });
			(props().onDeleted as () => void)();
			expect(mocks.navigate).toHaveBeenCalledWith({ to: "/patients" });
		});
	});

	describe("/patients/$id/edit", () => {
		it("loads the patient", async () => {
			mocks.getPatientFn.mockResolvedValue({ id: 5 });
			await expect(opts(EditRoute).loader!({ params: { id: "5" } })).resolves.toEqual({ id: 5 });
			expect(mocks.getPatientFn).toHaveBeenCalledWith({ data: 5 });
		});

		it("throws notFound when the patient does not exist", async () => {
			mocks.getPatientFn.mockResolvedValue(null);
			await expect(opts(EditRoute).loader!({ params: { id: "5" } })).rejects.toThrow("not-found");
		});

		it("renders the form for the loaded patient and navigates after saving", () => {
			mocks.loaderData.current = { id: 5, name: "Ana" };
			render(createElement(opts(EditRoute).component));
			expect(props().patient).toEqual({ id: 5, name: "Ana" });
			expect(props().locale).toBe("pt-BR");
			(props().onSaved as (id: number) => void)(5);
			expect(mocks.navigate).toHaveBeenCalledWith({
				to: "/patients/$id",
				params: { id: "5" },
			});
		});
	});
});
