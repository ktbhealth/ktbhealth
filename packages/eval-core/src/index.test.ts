import { describe, expect, it } from "vitest";

import * as evalCore from "./index.ts";
import type { ConfSegment, EditList, EvalAnswer, EvalQuestion, RunRecord } from "./schema.ts";
import { PortError } from "./ports.ts";

describe("eval-core barrel", () => {
	it("re-exports the public surface", () => {
		expect(evalCore.runBatch).toBeTypeOf("function");
		expect(evalCore.defineSuite).toBeTypeOf("function");
		expect(evalCore.ContributionRegistry).toBeTypeOf("function");
		expect(evalCore.PortError).toBeTypeOf("function");
		expect(evalCore.renderRunMarkdown).toBeTypeOf("function");
		expect(evalCore.calibrate).toBeTypeOf("function");
	});
});

describe("generic schema types", () => {
	it("RunRecord / EditList / ConfSegment / EvalQuestion / EvalAnswer shapes", () => {
		const record: RunRecord = {
			runId: "r1",
			taskId: "t1",
			stage: "stage",
			engine: "eng",
			inputHash: "h",
			startedAt: 0,
		};
		const edits: EditList = { ops: [] };
		const seg: ConfSegment = { correct: true };
		const q: EvalQuestion = { id: "q", kind: "noul", text: "t" };
		const a: EvalAnswer = { id: "q", kind: "noul", value: true, probability: 0.9 };
		expect(record.runId).toBe("r1");
		expect(edits.ops).toEqual([]);
		expect(seg.correct).toBe(true);
		expect(q.kind).toBe("noul");
		expect(a.probability).toBe(0.9);
	});

	it("PortError carries port + message", () => {
		const e = new PortError({ port: "asr", message: "down" });
		expect(e.port).toBe("asr");
		expect(e._tag).toBe("PortError");
	});
});
