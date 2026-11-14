import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { PortError } from "@ktb/eval-core";
import { ACP_VERSION, LlmPort, type AcpRequest } from "@ktb/eval-consultation";

import { makeAcpLlm, type AcpTransport } from "./llm.ts";

const respond = (payload: unknown, id = "t-1") => ({
	jsonrpc: ACP_VERSION,
	id,
	result: { payload },
});

const transport = (requests: AcpRequest[], impl: (r: AcpRequest) => unknown): AcpTransport => {
	return (r) =>
		Effect.sync(() => {
			requests.push(r);
			return impl(r);
		});
};

const env = (over?: Record<string, unknown>) => ({
	taskId: "t-1",
	role: "generator" as const,
	input: "i",
	outputSchema: "Text",
	...over,
});

const runGenerate = (t: AcpTransport, sessionId?: string, over?: Record<string, unknown>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const llm = yield* LlmPort;
			return yield* llm.generate(env(over));
		}).pipe(Effect.provide(makeAcpLlm({ transport: t, sessionId }))),
	);

describe("makeAcpLlm", () => {
	it("generate: encodes, transports, validates, returns text+record", async () => {
		const reqs: AcpRequest[] = [];
		const r = await runGenerate(
			transport(reqs, (r) => respond("texto gerado", r.id)),
			"sess-9",
		);
		expect(r.text).toBe("texto gerado");
		expect(r.record.engine).toBe("acp");
		expect(r.record.runId).toBe("sess-9");
		expect(r.record.stage).toBe("script_gen");
		expect(r.record.inputHash).toMatch(/^[0-9a-f]{8}$/);
		expect(reqs[0]?.method).toBe("task.submit");
		expect(reqs[0]?.params.sessionId).toBe("sess-9");
	});

	it("correct: decodes EditList payloads", async () => {
		const edits = { ops: [{ at: 0, remove: "a", insert: "b", kind: "fix" }] };
		const reqs: AcpRequest[] = [];
		const layer = makeAcpLlm({ transport: transport(reqs, (r) => respond(edits, r.id)) });
		const r = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* LlmPort;
				return yield* llm.correct(env({ role: "corrector", outputSchema: "EditList" }));
			}).pipe(Effect.provide(layer)),
		);
		expect(r.edits.ops).toHaveLength(1);
		expect(r.record.stage).toBe("cleanup");
	});

	it("transport failure surfaces as typed PortError", async () => {
		const dead: AcpTransport = () =>
			Effect.fail(new PortError({ port: "llm", message: "session dead" }));
		const err = await runGenerate(dead).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toBe("session dead");
	});

	it("generate flows a declared ConsultationScript envelope end-to-end", async () => {
		// S0 script generation declares outputSchema
		// "ConsultationScript" — the adapter must resolve it through the
		// registry, not a hardcoded "Text" literal.
		const reqs: AcpRequest[] = [];
		const r = await runGenerate(
			transport(reqs, (r) => respond("Doctor: o que sente? Patient: nada.", r.id)),
			undefined,
			{ outputSchema: "ConsultationScript" },
		);
		expect(r.text).toBe("Doctor: o que sente? Patient: nada.");
		expect(reqs[0]?.params.envelope.outputSchema).toBe("ConsultationScript");
	});

	it("generate rejects a validated non-string payload (declared EditList)", async () => {
		const edits = { ops: [{ at: 0, remove: "a", insert: "b", kind: "fix" }] };
		const err = await runGenerate(
			transport([], (r) => respond(edits, r.id)),
			undefined,
			{
				outputSchema: "EditList",
			},
		).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("requires a string payload");
	});

	it("rejects a mis-declared envelope before the transport is touched", async () => {
		let called = 0;
		const layer = makeAcpLlm({
			transport: (r) => {
				called++;
				return Effect.succeed(respond("ok", r.id));
			},
		});
		const err = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* LlmPort;
				// correct() but envelope declares Text — contract mismatch.
				return yield* llm.correct(env({ role: "corrector", outputSchema: "Text" }));
			}).pipe(Effect.provide(layer)),
		).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("outputSchema=EditList");
		expect(called).toBe(0); // transport never reached
	});

	it("times out a hanging transport as a typed PortError", async () => {
		const hanging: AcpTransport = () => Effect.never;
		const layer = makeAcpLlm({ transport: hanging, timeoutMs: 30 });
		const err = await Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* LlmPort;
				return yield* llm.generate(env());
			}).pipe(Effect.provide(layer)),
		).then(
			() => null,
			(e) => e,
		);
		expect(err).toBeInstanceOf(PortError);
		expect(err.message).toContain("timeout after 30ms");
	});

	it("invalid payloads are typed PortErrors, never silent", async () => {
		const r = await runGenerate(transport([], () => respond({ not: "text" }))).then(
			() => null,
			(e) => e,
		);
		expect(r).toBeInstanceOf(PortError);
	});

	it("agent errors surface with code+message", async () => {
		const agentErr: AcpTransport = (r) =>
			Effect.succeed({ jsonrpc: ACP_VERSION, id: r.id, error: { code: -1, message: "busy" } });
		const r = await runGenerate(agentErr).then(
			() => null,
			(e) => e,
		);
		expect(r.message).toContain("agent error -1");
	});
});

describe("egress declaration", () => {
	const flag = (egress?: boolean) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const llm = yield* LlmPort;
				return llm.egress;
			}).pipe(
				Effect.provide(
					makeAcpLlm({
						transport: () => Effect.succeed({}),
						...(egress !== undefined ? { egress } : {}),
					}),
				),
			),
		);

	it("defaults to egress (remote ACP agent) and honors the override", async () => {
		expect(await flag()).toBe(true);
		expect(await flag(false)).toBe(false);
	});
});
