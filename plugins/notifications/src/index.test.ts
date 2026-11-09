import { describe, expect, it } from "vitest";

import { notificationsHeaderPlugin } from "./index.ts";

describe("notifications.header plugin", () => {
	it("declares the header action contribution", () => {
		expect(notificationsHeaderPlugin.id).toBe("notifications.header");
		expect(notificationsHeaderPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(notificationsHeaderPlugin.optionalDeps).toEqual(["platform.header"]);
		expect(notificationsHeaderPlugin.panel?.headerActions).toHaveLength(1);
		expect(notificationsHeaderPlugin.panel?.headerActions?.[0]?.id).toBe("notifications");
	});
});
