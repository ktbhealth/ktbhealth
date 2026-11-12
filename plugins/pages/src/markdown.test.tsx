// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { markdownBlocks, renderInline, renderMarkdown } from "./markdown.tsx";

const Host = ({ source }: { source: string }) => <div>{renderMarkdown(source)}</div>;

afterEach(cleanup);

describe("markdownBlocks", () => {
	it("parses headings, lists, quotes, code and paragraphs", () => {
		const blocks = markdownBlocks(
			[
				"# Title",
				"## Sub",
				"### Deep",
				"",
				"- one",
				"- two",
				"1. first",
				"2. second",
				"> quoted",
				"```",
				"code line",
				"```",
				"plain text",
			].join("\n"),
		);
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"heading",
			"heading",
			"ul",
			"ol",
			"quote",
			"code",
			"p",
		]);
		expect(blocks[0]).toMatchObject({ level: 1, text: "Title" });
		expect(blocks[3]).toMatchObject({ items: ["one", "two"] });
		expect(blocks[6]).toMatchObject({ text: "code line" });
	});

	it("joins consecutive plain lines into one paragraph and skips blanks", () => {
		const blocks = markdownBlocks("line one\nline two\n\n\nline three");
		expect(blocks).toEqual([
			{ kind: "p", text: "line one line two" },
			{ kind: "p", text: "line three" },
		]);
	});

	it("tolerates an unterminated code fence and empty input", () => {
		expect(markdownBlocks("```\nopen").at(-1)).toMatchObject({ kind: "code", text: "open" });
		expect(markdownBlocks("")).toEqual([]);
		expect(markdownBlocks("\n\n  \n")).toEqual([]);
	});
});

describe("renderInline", () => {
	it("renders bold, italic, code and safe links", () => {
		const { container } = render(
			<div>{renderInline("a **bold** b *it* c `x` [ok](https://x.com) [in](/about)")}</div>,
		);
		expect(container.querySelector("strong")?.textContent).toBe("bold");
		expect(container.querySelector("em")?.textContent).toBe("it");
		expect(container.querySelector("code")?.textContent).toBe("x");
		const links = [...container.querySelectorAll("a")];
		expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://x.com", "/about"]);
		expect(links[0]?.getAttribute("target")).toBe("_blank");
		expect(links[1]?.getAttribute("target")).toBeNull();
	});

	it("renders unsafe link targets as literal text", () => {
		const { container } = render(<div>{renderInline("[x](javascript:alert(1))")}</div>);
		expect(container.querySelector("a")).toBeNull();
		expect(container.textContent).toContain("javascript:alert(1)");
	});
});

describe("renderMarkdown", () => {
	it("renders the full subset into elements", () => {
		const { container } = render(
			<Host source={"# Title\n\npara **bold**\n\n- i1\n- i2\n\n> quote\n\n```\ncode\n```"} />,
		);
		expect(container.querySelector("h2")).toBeTruthy();
		expect(container.querySelector("strong")?.textContent).toBe("bold");
		expect(container.querySelectorAll("li")).toHaveLength(2);
		expect(container.querySelector("blockquote")).toBeTruthy();
		expect(container.querySelector("pre code")?.textContent).toBe("code");
	});

	it("renders ordered lists", () => {
		const { container } = render(<Host source={"1. first\n2. second"} />);
		const ol = container.querySelector("ol");
		expect(ol).toBeTruthy();
		expect([...ol!.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
			"first",
			"second",
		]);
	});
});
