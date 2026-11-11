/**
 * Permission vocabulary (P-054): the flat `(resource, action)` catalog
 * role grants are validated against. The proposal calls for a generated
 * catalog derived from the app's permix `Def` plus an explicit
 * `platformActions` list — full codegen is deferred; this module is the
 * typed constants stand-in, kept in sync with `@ktb/authz`'s `Def`
 * (patient.*, consultation.*) by hand until the generator lands.
 *
 * Entries are `"resource.action"` strings — the same spelling permix
 * paths and `Permissions.can(resource, action)` calls use, so the
 * static and rbac authz modes share one vocabulary.
 */

/** Actions the platform layer owns, outside any entity permix Def. */
export const PLATFORM_ACTIONS = [
	"platform.admin",
	"billing.manage",
	"members.invite",
	"groups.read",
	"groups.manage",
	"rbac.read",
	"rbac.manage",
] as const;

/** Entity actions mirrored from the permix `Def` in @ktb/authz. */
export const ENTITY_ACTIONS = [
	"patient.create",
	"patient.read",
	"patient.update",
	"patient.delete",
	"consultation.create",
	"consultation.read",
	"consultation.update",
	"consultation.delete",
] as const;

/** The full known catalog: entity actions + platform actions. */
export const PERMISSION_CATALOG = [...ENTITY_ACTIONS, ...PLATFORM_ACTIONS] as const;

export type Permission = (typeof PERMISSION_CATALOG)[number];

/** Split a dotted `"resource.action"` catalog entry. */
export const splitPermission = (permission: string): { resource: string; action: string } => {
	const dot = permission.indexOf(".");
	return dot === -1
		? { resource: permission, action: "" }
		: { resource: permission.slice(0, dot), action: permission.slice(dot + 1) };
};

/** `"resource.action"` spelling of a (resource, action) pair. */
export const permissionKey = (resource: string, action: string): string => `${resource}.${action}`;

/** Whether `(resource, action)` is in the known catalog. The package
 * validates shape, not meaning — this helper exists for role-editing
 * UIs that want to warn on unknown grants, not as an enforcement gate. */
export const isKnownPermission = (resource: string, action: string): boolean =>
	(PERMISSION_CATALOG as readonly string[]).includes(permissionKey(resource, action));
