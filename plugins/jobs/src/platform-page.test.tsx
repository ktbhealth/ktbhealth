// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: async () => {} }),
}));
vi.mock("./fns.ts", () => ({
	retryAudioJobFn: async () => ({ ok: true }),
}));

import type { PanelPageContext } from "@ktb/kernel";

import { OpsPlatformPage } from "./platform-page.tsx";

const ctx: PanelPageContext = { plugins: [], locale: "en" };

afterEach(cleanup);

describe("OpsPlatformPage", () => {
	it("renders unavailable sections when the loader data is missing", () => {
		render(<OpsPlatformPage data={undefined} ctx={ctx} />);
		expect(screen.getByText("Ops")).toBeTruthy();
		expect(screen.getAllByText("Signal unavailable")).toHaveLength(3);
	});

	it("narrows loader data into the ops view", () => {
		render(
			<OpsPlatformPage
				data={{
					jobs: [
						{
							id: 9,
							audioStatus: "failed",
							audioError: "boom",
							createdAt: "2025-01-01T00:00:00.000Z",
							patientName: "Ana",
						},
					],
					queue: { pending: 1, processing: 0, done: 2, failed: 0 },
					storage: { objects: 3, bytes: 99, truncated: false },
				}}
				ctx={ctx}
			/>,
		);
		expect(screen.getByText("#9")).toBeTruthy();
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("3 objects")).toBeTruthy();
	});
});
