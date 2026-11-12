import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { Forbidden } from "@ktb/authz";

import {
	RbacAssignSubject,
	RbacAssignments,
	RbacCatalog,
	RbacCreateRole,
	RbacDeleteRole,
	RbacRevokeRolePermission,
	RbacRole,
	RbacRoles,
	RbacSetRolePermission,
	RbacUnassignSubject,
	RbacUpdateRole,
} from "./api.ts";

const messages = [
	RbacCatalog,
	RbacRoles,
	RbacRole,
	RbacAssignments,
	RbacCreateRole,
	RbacUpdateRole,
	RbacDeleteRole,
	RbacSetRolePermission,
	RbacRevokeRolePermission,
	RbacAssignSubject,
	RbacUnassignSubject,
];

describe("rbac api failure schemas", () => {
	it("every message declares a Forbidden-only failure schema", () => {
		for (const message of messages) {
			const isForbidden = Schema.is(message.schemas.failure as Schema.Schema<Forbidden>);
			expect(isForbidden(new Forbidden({ path: "platform.admin" }))).toBe(true);
			expect(isForbidden(new Error("nope"))).toBe(false);
			expect(isForbidden({ _tag: "Forbidden", path: "x" })).toBe(false);
		}
	});
});
