import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { Forbidden } from "@ktb/authz";

import { NotificationsMarkAllRead, NotificationsMarkRead } from "./api.ts";

describe("notification command failure schema", () => {
	it.each([
		["markRead", NotificationsMarkRead.schemas.failure],
		["markAllRead", NotificationsMarkAllRead.schemas.failure],
	])("%s accepts Forbidden and rejects anything else", (_name, failure) => {
		const isForbidden = Schema.is(failure as Schema.Schema<Forbidden>);
		expect(isForbidden(new Forbidden({ path: "notification.update" }))).toBe(true);
		expect(isForbidden(new Error("nope"))).toBe(false);
		expect(isForbidden({ _tag: "Forbidden", path: "x" })).toBe(false);
	});
});
