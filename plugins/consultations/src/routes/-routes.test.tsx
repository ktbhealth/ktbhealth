// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getConsultationFn: vi.fn(),
	patientHistoryFn: vi.fn(),
	loaderData: { current: undefined as unknown },
	props: { current: undefined as Record<string, unknown> | undefined },
}));

vi.mock("../guard.ts", () => ({ requireDoctor: vi.fn() }));
vi.mock("../fns.ts", () => ({
	getConsultationFn: mocks.getConsultationFn,
	patientHistoryFn: mocks.patientHistoryFn,
	attachAnamnesisFn: vi.fn(),
	extractAnamnesisFn: vi.fn(),
	getLiveConsultationFn: vi.fn(),
	recordConsentFn: vi.fn(),
	saveConsultationFn: vi.fn(),
	sessionUserFn: vi.fn(),
	localeFn: vi.fn(),
}));
vi.mock("../whisper-prefetch.ts", () => ({ prefetchWhisperModel: vi.fn() }));
vi.mock("@ktb/transcription-whisper", () => ({ whisperBackend: { id: "whisper" } }));
vi.mock("../views/index.ts", () => ({
	ConsultationDetailPage: (props: Record<string, unknown>) => {
		mocks.props.current = props;
		return createElement("div");
	},
	NewConsultationPage: () => createElement("div"),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		createFileRoute: () => (opts: Record<string, unknown>) => ({
			options: opts,
			useLoaderData: () => mocks.loaderData.current,
			useSearch: () => ({}),
		}),
	};
});

import { Route as DetailRoute } from "./$id.tsx";
import { newConsultationApi } from "../apis.ts";

type Opts = {
	staleTime: number;
	beforeLoad: () => unknown;
	loader: (a: { params: { id: string } }) => Promise<unknown>;
	component: () => ReactElement;
};
const opts = (DetailRoute as unknown as { options: Opts }).options;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("/consultations/$id", () => {
	it("caches the loader result for 30s and guards the session", () => {
		expect(opts.staleTime).toBe(30_000);
		expect(() => opts.beforeLoad()).not.toThrow();
	});

	it("throws notFound when the consultation does not exist", async () => {
		mocks.getConsultationFn.mockResolvedValue(null);
		await expect(opts.loader({ params: { id: "9" } })).rejects.toMatchObject({ isNotFound: true });
		expect(mocks.getConsultationFn).toHaveBeenCalledWith({ data: 9 });
	});

	it("skips the history for a consultation without a patient", async () => {
		const c = { id: 9, patientId: null };
		mocks.getConsultationFn.mockResolvedValue(c);
		await expect(opts.loader({ params: { id: "9" } })).resolves.toEqual({ c, history: null });
		expect(mocks.patientHistoryFn).not.toHaveBeenCalled();
	});

	it("loads the patient history, excluding the current consultation", async () => {
		const c = { id: 9, patientId: 4 };
		mocks.getConsultationFn.mockResolvedValue(c);
		mocks.patientHistoryFn.mockResolvedValue({ items: [] });
		await expect(opts.loader({ params: { id: "9" } })).resolves.toEqual({
			c,
			history: { items: [] },
		});
		expect(mocks.patientHistoryFn).toHaveBeenCalledWith({
			data: { patientId: 4, excludeId: 9 },
		});
	});

	it("renders the detail page with a live-refetch api backed by getConsultationFn", async () => {
		mocks.loaderData.current = { c: { id: 9 }, history: null };
		mocks.getConsultationFn.mockResolvedValue({ id: 9, audioStatus: "done" });
		render(createElement(opts.component));
		const props = mocks.props.current!;
		expect(props.c).toEqual({ id: 9 });
		expect(props.history).toBeNull();
		const api = props.api as { getConsultation: (i: { data: number }) => Promise<unknown> };
		await expect(api.getConsultation({ data: 9 })).resolves.toEqual({ id: 9, audioStatus: "done" });
		expect(mocks.getConsultationFn).toHaveBeenCalledWith({ data: 9 });
	});
});

describe("newConsultationApi", () => {
	it("delegates getConsultation to the server fn", async () => {
		mocks.getConsultationFn.mockResolvedValue({ id: 3 });
		await expect(newConsultationApi.getConsultation!({ data: 3 })).resolves.toEqual({ id: 3 });
		expect(mocks.getConsultationFn).toHaveBeenCalledWith({ data: 3 });
	});
});
