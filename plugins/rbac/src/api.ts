import * as Schema from "effect/Schema";
import { Command, Query } from "@effect-server-utils/cqrs";
import { Forbidden } from "@ktb/authz";

/** `Forbidden` is a `Data.TaggedError`, not a `Schema` — declare a schema
 * view of it so command failures stay typed end to end. */
const ForbiddenSchema = Schema.declare<Forbidden>((u): u is Forbidden => u instanceof Forbidden);

// ---------- wire shapes ----------

const PermissionEffect = Schema.Literals(["allow", "deny"]);
const SubjectKind = Schema.Literals(["user", "group"]);

export const RoleRow = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	meta: Schema.NullOr(Schema.String),
	createdAt: Schema.Date,
});

export const RolePermissionRow = Schema.Struct({
	id: Schema.Number,
	roleId: Schema.Number,
	resource: Schema.String,
	action: Schema.String,
	effect: PermissionEffect,
});

export const SubjectRoleRow = Schema.Struct({
	id: Schema.Number,
	subjectKind: SubjectKind,
	subjectId: Schema.String,
	roleId: Schema.Number,
	roleName: Schema.String,
	tenantId: Schema.NullOr(Schema.String),
	grantedBy: Schema.NullOr(Schema.String),
	expiresAt: Schema.NullOr(Schema.Date),
});

/** Role + its grants, for the permission-matrix editor. */
export const RoleDetail = Schema.Struct({
	role: RoleRow,
	permissions: Schema.Array(RolePermissionRow),
});

/** One catalog entry (`"resource.action"`) for the matrix editor. */
export const CatalogEntry = Schema.Struct({
	key: Schema.String,
	resource: Schema.String,
	action: Schema.String,
});

// ---------- queries ----------

export const RbacCatalog = Query.make("rbac.catalog", {
	payload: {},
	success: Schema.Array(CatalogEntry),
	failure: ForbiddenSchema,
});

export const RbacRoles = Query.make("rbac.roles", {
	payload: {},
	success: Schema.Array(RoleRow),
	failure: ForbiddenSchema,
});

export const RbacRole = Query.make("rbac.role", {
	payload: { id: Schema.Number },
	success: Schema.NullOr(RoleDetail),
	failure: ForbiddenSchema,
});

export const RbacAssignments = Query.make("rbac.assignments", {
	payload: {},
	success: Schema.Array(SubjectRoleRow),
	failure: ForbiddenSchema,
});

export const RbacQueries = Query.group(RbacCatalog, RbacRoles, RbacRole, RbacAssignments);

// ---------- commands ----------

const RoleName = Schema.NonEmptyString;

export const RbacCreateRole = Command.make("rbac.createRole", {
	payload: {
		name: RoleName,
		description: Schema.optionalKey(Schema.NullOr(Schema.String)),
		meta: Schema.optionalKey(Schema.NullOr(Schema.String)),
	},
	success: RoleRow,
	failure: ForbiddenSchema,
});

export const RbacUpdateRole = Command.make("rbac.updateRole", {
	payload: {
		id: Schema.Number,
		name: Schema.optionalKey(RoleName),
		description: Schema.optionalKey(Schema.NullOr(Schema.String)),
		meta: Schema.optionalKey(Schema.NullOr(Schema.String)),
	},
	success: Schema.NullOr(RoleRow),
	failure: ForbiddenSchema,
});

export const RbacDeleteRole = Command.make("rbac.deleteRole", {
	payload: { id: Schema.Number },
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const RbacSetRolePermission = Command.make("rbac.setRolePermission", {
	payload: {
		roleId: Schema.Number,
		resource: Schema.NonEmptyString,
		action: Schema.NonEmptyString,
		effect: PermissionEffect,
	},
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const RbacRevokeRolePermission = Command.make("rbac.revokeRolePermission", {
	payload: {
		roleId: Schema.Number,
		resource: Schema.NonEmptyString,
		action: Schema.NonEmptyString,
	},
	success: Schema.Void,
	failure: ForbiddenSchema,
});

/** `expiresAt` accepts an ISO string or epoch ms on the wire; the
 * handler normalizes to a Date (null/undefined = never expires). */
const ExpiresAtInput = Schema.optionalKey(
	Schema.NullOr(Schema.Union([Schema.Date, Schema.String, Schema.Number])),
);

export const RbacAssignSubject = Command.make("rbac.assignSubject", {
	payload: {
		subjectKind: SubjectKind,
		subjectId: Schema.NonEmptyString,
		roleId: Schema.Number,
		tenantId: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
		expiresAt: ExpiresAtInput,
	},
	success: SubjectRoleRow,
	failure: ForbiddenSchema,
});

export const RbacUnassignSubject = Command.make("rbac.unassignSubject", {
	payload: { id: Schema.Number },
	success: Schema.Void,
	failure: ForbiddenSchema,
});

export const RbacCommands = Command.group(
	RbacCreateRole,
	RbacUpdateRole,
	RbacDeleteRole,
	RbacSetRolePermission,
	RbacRevokeRolePermission,
	RbacAssignSubject,
	RbacUnassignSubject,
);
