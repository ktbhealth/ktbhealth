/**
 * acp.ts — TaskEnvelope wire contract for ACP-delegated generation
 * (T-103). Pure serialization — no transport, no I/O. The format is
 * frozen by tests: any change here is a protocol change.
 *
 * Wire shape (JSON-RPC 2.0 flavored):
 *   request : {jsonrpc, id=taskId, method:"task.submit", params:{sessionId?, envelope}}
 *   response: {jsonrpc, id, result:{payload}} | {jsonrpc, id, error:{code,message}}
 *
 * `outputSchema` on the envelope names a validator in a REGISTRY —
 * adapters resolve the declared contract dynamically instead of
 * hard-coding per-role shapes. Unregistered/undeclared contracts fail
 * typed, never silently.
 */

import { Schema } from "effect";

import { PortError, type TaskEnvelope } from "./ports.ts";
import { EditList } from "./schema.ts";

export const ACP_VERSION = "2.0" as const;
export const ACP_METHOD = "task.submit" as const;

export interface AcpRequest {
	readonly jsonrpc: typeof ACP_VERSION;
	readonly id: string;
	readonly method: typeof ACP_METHOD;
	readonly params: {
		readonly sessionId?: string;
		readonly envelope: TaskEnvelope;
	};
}

export interface AcpResponse {
	readonly jsonrpc: string;
	readonly id: string;
	readonly result?: { readonly payload?: unknown };
	readonly error?: { readonly code: number; readonly message: string };
}

/** Decode a `result.payload` into the declared output contract. */
export type OutputValidator = (payload: unknown) => unknown;

/** Named output contracts. Extensible: adapters may register their
 * own schema names without touching this module. */
export const outputValidators: Record<string, OutputValidator> = {
	Text: (payload) => {
		if (typeof payload !== "string") {
			throw new Error("expected string payload");
		}
		return payload;
	},
	// S0 script generation — the script is
	// plain text, but an EMPTY script is a failed generation, not a
	// valid one.
	ConsultationScript: (payload) => {
		if (typeof payload !== "string" || payload.trim().length === 0) {
			throw new Error("expected non-empty string payload");
		}
		return payload;
	},
	EditList: (payload) => Schema.decodeUnknownSync(EditList)(payload),
};

export const encodeTask = (envelope: TaskEnvelope, sessionId?: string): AcpRequest => ({
	jsonrpc: ACP_VERSION,
	id: envelope.taskId,
	method: ACP_METHOD,
	params: {
		...(sessionId !== undefined ? { sessionId } : {}),
		envelope,
	},
});

const fail = (port: string, message: string) => new PortError({ port, message });

/** Validates + unwraps a wire response against the envelope's declared
 * outputSchema. Throws PortError — typed, never a defect. */
export const decodeTaskResult = (input: {
	readonly response: unknown;
	readonly envelope: TaskEnvelope;
	readonly validators?: Record<string, OutputValidator>;
}): unknown => {
	const res = input.response as AcpResponse;
	if (
		typeof res !== "object" ||
		res === null ||
		res.jsonrpc !== ACP_VERSION ||
		res.id !== input.envelope.taskId
	) {
		throw fail("llm", "response does not match request id/version");
	}
	if (res.error !== undefined) {
		throw fail("llm", `agent error ${res.error.code}: ${res.error.message}`);
	}
	const validator = (input.validators ?? outputValidators)[input.envelope.outputSchema];
	if (validator === undefined) {
		throw fail("llm", `unknown outputSchema: ${input.envelope.outputSchema}`);
	}
	try {
		return validator(res.result?.payload);
	} catch (e) {
		throw fail(
			"llm",
			`payload failed ${input.envelope.outputSchema} validation: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
};
