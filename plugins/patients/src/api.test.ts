import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { Forbidden } from "@ktb/authz";

import { PatientDelete } from "./api.ts";

describe("patients.delete failure schema", () => {
	it("accepts Forbidden and rejects anything else", () => {
		const isForbidden = Schema.is(PatientDelete.schemas.failure as Schema.Schema<Forbidden>);
		expect(isForbidden(new Forbidden({ path: "patient.delete" }))).toBe(true);
		expect(isForbidden(new Error("nope"))).toBe(false);
		expect(isForbidden({ _tag: "Forbidden", path: "x" })).toBe(false);
	});
});
