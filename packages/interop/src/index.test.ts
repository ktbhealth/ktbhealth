import { describe, expect, it } from "vitest";

import { EXPORT_FORMATS, isExportFormat } from "./index.ts";

describe("export formats", () => {
	it("accepts only the supported standards", () => {
		expect(EXPORT_FORMATS).toEqual(["fhir-r4", "openehr"]);
		expect(isExportFormat("fhir-r4")).toBe(true);
		expect(isExportFormat("openehr")).toBe(true);
		expect(isExportFormat("hl7v2")).toBe(false);
		expect(isExportFormat(null)).toBe(false);
	});
});
