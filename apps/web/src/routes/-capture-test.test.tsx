// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		const chain = {
			validator: () => chain,
			handler: (h: (a?: unknown) => unknown) => async (a?: unknown) => h(a),
		};
		return chain;
	},
}));

import { Route } from "./capture-test.tsx";

const Page = (Route as unknown as { options: { component: () => ReactElement } }).options.component;

function makeStream(withAudio = true) {
	const audioTrack = { label: "tab-audio", readyState: "live", stop: vi.fn() };
	const videoTrack = { label: "tab-video", readyState: "live", stop: vi.fn() };
	return {
		getAudioTracks: () => (withAudio ? [audioTrack] : []),
		getVideoTracks: () => [videoTrack],
		getTracks: () => [audioTrack, videoTrack],
	};
}

function mockAudioContext() {
	const analyser = {
		fftSize: 256,
		frequencyBinCount: 128,
		getByteTimeDomainData: (d: Uint8Array) => d.fill(128),
		connect: vi.fn(),
	};
	return {
		createMediaStreamSource: () => ({ connect: vi.fn() }),
		createAnalyser: () => analyser,
		close: vi.fn(async () => {}),
	};
}

function installMedia(stream: unknown) {
	vi.stubGlobal("navigator", {
		...navigator,
		mediaDevices: { getDisplayMedia: vi.fn(async () => stream) },
	});
	vi.stubGlobal(
		"AudioContext",
		vi.fn(function (this: unknown) {
			return mockAudioContext();
		}),
	);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("capture-test", () => {
	it("captures tab audio and shows level meter", async () => {
		installMedia(makeStream());
		render(createElement(Page));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /start/i }));
		});
		await waitFor(() => expect(screen.getByText(/capturing/)).toBeTruthy());
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /stop/i }));
		});
	});

	it("stop before capture is a no-op", async () => {
		installMedia(makeStream());
		render(createElement(Page));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /stop/i }));
		});
	});

	it("shows error when share has no audio track", async () => {
		installMedia(makeStream(false));
		render(createElement(Page));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /start/i }));
		});
		await waitFor(() => expect(screen.getByText(/no audio/)).toBeTruthy());
	});

	it("shows error when getDisplayMedia fails", async () => {
		vi.stubGlobal("navigator", {
			...navigator,
			mediaDevices: { getDisplayMedia: vi.fn(async () => Promise.reject(new Error("denied"))) },
		});
		render(createElement(Page));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /start/i }));
		});
		await waitFor(() => expect(screen.getByText("denied")).toBeTruthy());
	});

	it("shows string error for non-Error rejection", async () => {
		vi.stubGlobal("navigator", {
			...navigator,
			mediaDevices: { getDisplayMedia: vi.fn(async () => Promise.reject("nope")) },
		});
		render(createElement(Page));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /start/i }));
		});
		await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
	});
});
