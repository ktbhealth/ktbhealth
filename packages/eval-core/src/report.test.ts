import { describe, expect, it } from "vitest";

import { renderRunMarkdown } from "./report.ts";
import type { RunRecord } from "./schema.ts";

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
	runId: "r1",
	taskId: "t",
	stage: "asr",
	engine: "eng",
	inputHash: "h",
	startedAt: 0,
	...over,
});

describe("renderRunMarkdown", () => {
	it("renders a markdown table for matching records only", () => {
		const md = renderRunMarkdown("r1", [
			record({ sampleId: "s1", model: "m", latencyMs: 5, estCostUsd: 0.01 }),
			record({ runId: "other" }),
		]);
		expect(md).toContain("# run r1");
		expect(md).toContain("| s1 | asr | eng | m | 5 | 0.01 |");
		expect(md).not.toContain("other");
	});

	it("missing optional fields render as '-'", () => {
		const md = renderRunMarkdown("r1", [record()]);
		expect(md).toContain("| - | asr | eng | - | - | - |");
	});

	it("escapes pipes inside cell values", () => {
		const md = renderRunMarkdown("r1", [record({ engine: "a|b" })]);
		expect(md).toContain("a\\|b");
	});

	it("no matching records → 'no records'", () => {
		expect(renderRunMarkdown("none", [record()])).toContain("no records");
		expect(renderRunMarkdown("none", [])).toContain("no records");
	});
});
