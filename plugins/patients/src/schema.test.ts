import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { describe, expect, it } from "vitest";

import { patients } from "@ktb/db/schema";

describe("patients schema", () => {
	it("exposes table config with owner FK", () => {
		const cfg = getTableConfig(patients);
		expect(cfg.name).toBe("patients");
		expect(cfg.columns.map((c) => c.name)).toContain("owner_id");
		for (const fk of cfg.foreignKeys) {
			expect(fk.reference().foreignColumns.length).toBeGreaterThan(0);
		}
	});
});
