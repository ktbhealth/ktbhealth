import { describe, expect, it } from "vitest";

import { ACP_METHOD, ACP_VERSION, decodeTaskResult, encodeTask, outputValidators } from "./acp.ts";
import { PortError, type TaskEnvelope } from "./ports.ts";

const envelope = (over?: Partial<TaskEnvelope>): TaskEnvelope => ({
	taskId: "t-1",
	role: "generator",
	input: "hello",
	outputSchema: "Text",
	...over,
});

const okResponse = (payload: unknown, id = "t-1") => ({
	jsonrpc: ACP_VERSION,
	id,
	result: { payload },
});

describe("encodeTask — frozen wire format", () => {
	it("serializes the envelope under task.submit with id=taskId", () => {
		const req = encodeTask(envelope(), "sess-1");
		expect(req).toEqual({
			jsonrpc: "2.0",
			id: "t-1",
			method: "task.submit",
			params: {
				sessionId: "sess-1",
				envelope: envelope(),
			},
		});
		expect(req.method).toBe(ACP_METHOD);
	});

	it("omits sessionId when absent", () => {
		const req = encodeTask(envelope());
		expect(req.params).not.toHaveProperty("sessionId");
	});
});

describe("decodeTaskResult", () => {
	it("validates Text payloads", () => {
		const out = decodeTaskResult({ response: okResponse("done"), envelope: envelope() });
		expect(out).toBe("done");
	});

	it("validates ConsultationScript payloads (non-empty string)", () => {
		const out = decodeTaskResult({
			response: okResponse("Doctor: o que sente?"),
			envelope: envelope({ outputSchema: "ConsultationScript" }),
		});
		expect(out).toBe("Doctor: o que sente?");
	});

	it("rejects empty ConsultationScript payloads", () => {
		expect(() =>
			decodeTaskResult({
				response: okResponse("   "),
				envelope: envelope({ outputSchema: "ConsultationScript" }),
			}),
		).toThrow(/ConsultationScript validation/);
	});

	it("validates EditList payloads through the Schema", () => {
		const edits = { ops: [{ at: 0, remove: "a", insert: "b", kind: "fix" }] };
		const out = decodeTaskResult({
			response: okResponse(edits),
			envelope: envelope({ outputSchema: "EditList" }),
		});
		expect(out).toEqual(edits);
	});

	it("rejects mismatched request id", () => {
		expect(() =>
			decodeTaskResult({ response: okResponse("x", "other"), envelope: envelope() }),
		).toThrow(PortError);
	});

	it("rejects wrong protocol version", () => {
		expect(() =>
			decodeTaskResult({
				response: { ...okResponse("x"), jsonrpc: "1.0" },
				envelope: envelope(),
			}),
		).toThrow(PortError);
	});

	it("rejects non-object responses", () => {
		expect(() => decodeTaskResult({ response: "not an object", envelope: envelope() })).toThrow(
			PortError,
		);
	});

	it("surfaces agent-side errors", () => {
		expect(() =>
			decodeTaskResult({
				response: { jsonrpc: ACP_VERSION, id: "t-1", error: { code: 42, message: "refused" } },
				envelope: envelope(),
			}),
		).toThrow(/agent error 42/);
	});

	it("rejects unknown outputSchema", () => {
		expect(() =>
			decodeTaskResult({
				response: okResponse("x"),
				envelope: envelope({ outputSchema: "Frobnicate" }),
			}),
		).toThrow(/unknown outputSchema/);
	});

	it("rejects payloads failing the declared validator", () => {
		expect(() => decodeTaskResult({ response: okResponse(42), envelope: envelope() })).toThrow(
			/Text validation/,
		);
	});

	it("wraps non-Error validator throws too", () => {
		expect(() =>
			decodeTaskResult({
				response: okResponse("x"),
				envelope: envelope({ outputSchema: "Weird" }),
				validators: {
					Weird: () => {
						throw "raw-string-error";
					},
				},
			}),
		).toThrow(/raw-string-error/);
	});

	it("honors a caller-supplied validator registry (dynamic contracts)", () => {
		const out = decodeTaskResult({
			response: okResponse("3.14"),
			envelope: envelope({ outputSchema: "Number" }),
			validators: { ...outputValidators, Number: (p) => Number(p) },
		});
		expect(out).toBe(3.14);
	});
});
