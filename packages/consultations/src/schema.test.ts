import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { consultations } from "./schema.ts";

describe("consultations schema", () => {
	it("exposes table config with FKs and defaults", () => {
		const cfg = getTableConfig(consultations);
		expect(cfg.name).toBe("consultations");
		const names = cfg.columns.map((c) => c.name);
		expect(names).toEqual(
			expect.arrayContaining(["user_id", "patient_id", "transcript", "anamnesis", "status"]),
		);
		for (const fk of cfg.foreignKeys) {
			expect(fk.reference().foreignColumns.length).toBeGreaterThan(0);
		}
	});
});
