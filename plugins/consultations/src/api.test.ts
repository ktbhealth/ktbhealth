import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { Forbidden } from "@ktb/authz";

import { ConsultationsAudioJobs } from "./api.ts";

describe("consultations.audioJobs failure schema", () => {
	it("accepts Forbidden and rejects anything else", () => {
		const isForbidden = Schema.is(
			ConsultationsAudioJobs.schemas.failure as Schema.Schema<Forbidden>,
		);
		expect(isForbidden(new Forbidden({ path: "platform.admin" }))).toBe(true);
		expect(isForbidden(new Error("nope"))).toBe(false);
		expect(isForbidden({ _tag: "Forbidden", path: "x" })).toBe(false);
	});
});
