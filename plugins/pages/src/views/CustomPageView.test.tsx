// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PageContext } from "@ktb/kernel";

import { CustomPageView } from "./CustomPageView.tsx";

const ctx: PageContext = { plugins: [], locale: "en" };

afterEach(cleanup);

describe("CustomPageView", () => {
	it("renders the title and markdown content", () => {
		render(
			<CustomPageView
				data={{ path: "/about", title: "About us", content: "# Hi\n\nSome **bold** text." }}
				ctx={ctx}
			/>,
		);
		expect(screen.getByText("About us")).toBeTruthy();
		expect(screen.getByText("bold").tagName).toBe("STRONG");
	});

	it("renders nothing for missing or malformed data", () => {
		const { container, rerender } = render(<CustomPageView data={null} ctx={ctx} />);
		expect(container.innerHTML).toBe("");
		rerender(<CustomPageView data="nope" ctx={ctx} />);
		expect(container.innerHTML).toBe("");
		rerender(<CustomPageView data={{ title: 42 }} ctx={ctx} />);
		expect(container.innerHTML).toBe("");
	});
});
