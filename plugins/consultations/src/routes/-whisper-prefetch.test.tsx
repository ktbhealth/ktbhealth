// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	prefersWhisper: { current: true },
	prefetchWhisperModel: vi.fn(),
	loaderData: { current: undefined as unknown },
}));

vi.mock("../guard.ts", () => ({ requireDoctor: vi.fn() }));
vi.mock("../fns.ts", () => ({
	listConsultationsFn: vi.fn(async () => []),
	localeFn: vi.fn(async () => "en"),
	getConsultationFn: vi.fn(),
	patientHistoryFn: vi.fn(),
}));
vi.mock("../apis.ts", () => ({
	newConsultationApi: {},
	newConsultationLoader: vi.fn(async () => []),
	validateNewConsultationSearch: vi.fn(() => ({})),
}));
vi.mock("../backend.ts", () => ({
	get prefersWhisper() {
		return mocks.prefersWhisper.current;
	},
	transcriptionBackend: { id: "whisper" },
}));
vi.mock("../whisper-prefetch.ts", () => ({
	prefetchWhisperModel: mocks.prefetchWhisperModel,
}));
vi.mock("../views/index.ts", () => ({
	ConsultationsPage: () => createElement("div"),
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

import { Route as IndexRoute } from "./index.tsx";
import { Route as NewRoute } from "./new.tsx";

type Opts = { component: () => ReactElement };
const componentOf = (route: unknown) => (route as { options: Opts }).options.component;

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.prefersWhisper.current = true;
});

describe("consultation routes whisper prefetch", () => {
	it("/consultations warms the model when whisper won resolution", () => {
		mocks.loaderData.current = { consultations: [], locale: "en" };
		render(createElement(componentOf(IndexRoute)));
		expect(mocks.prefetchWhisperModel).toHaveBeenCalledTimes(1);
	});

	it("/consultations skips prefetch on the web speech fallback", () => {
		mocks.prefersWhisper.current = false;
		mocks.loaderData.current = { consultations: [], locale: "en" };
		render(createElement(componentOf(IndexRoute)));
		expect(mocks.prefetchWhisperModel).not.toHaveBeenCalled();
	});

	it("/consultations/new warms the model when whisper won resolution", () => {
		mocks.loaderData.current = { initialPatients: [], locale: "en" };
		render(createElement(componentOf(NewRoute)));
		expect(mocks.prefetchWhisperModel).toHaveBeenCalledTimes(1);
	});

	it("/consultations/new skips prefetch on the web speech fallback", () => {
		mocks.prefersWhisper.current = false;
		mocks.loaderData.current = { initialPatients: [], locale: "en" };
		render(createElement(componentOf(NewRoute)));
		expect(mocks.prefetchWhisperModel).not.toHaveBeenCalled();
	});
});
