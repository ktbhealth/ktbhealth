import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Forbidden } from "@ktb/authz";
import { Groups, groupsServicesPlugin, type AdminGroupRow, type GroupMember } from "@ktb/groups";
import { definePlugin, type Plugin } from "@ktb/kernel";
import { platformPanelPlugin } from "@ktb/platform";
import type { TenantRole } from "@ktb/tenant";
import { Building2Icon } from "lucide-react";

import { TenantsPlatformPage } from "./platform-page.tsx";

/**
 * @ktb/tenant-plugin — the /platform tenant console (P-053, phase C).
 *
 * Tenants ARE groups: `groups` rows are tenants (`kind` is the tenant
 * kind, `slug`/`meta` the descriptor fields) and `group_members` rows
 * with `memberKind === "user"` are tenant memberships whose free-form
 * `role` normalizes onto the built-in TenantRole set (see the app's
 * tenant-directory adapter). This plugin is the TENANT view of that
 * data for platform admins — group CRUD stays in plugins/groups; the
 * tenant page manages memberships and roles only.
 *
 * All admin ops delegate to the Groups service, which re-checks the
 * PlatformAdmin env-allowlist gate — defense in depth on top of the
 * /platform layout guard.
 */

/** Console row: a group viewed as a tenant (member count included). */
export type TenantRow = AdminGroupRow;

/** Tenant member: a `memberKind === "user"` group_members row. */
export type TenantMember = GroupMember;

export interface AddTenantMemberInput {
	readonly tenantId: number;
	readonly memberId: string;
	readonly role?: string | null;
}

export interface RemoveTenantMemberInput {
	readonly tenantId: number;
	readonly memberId: string;
}

export interface SetTenantMemberRoleInput {
	readonly tenantId: number;
	readonly memberId: string;
	/** `null` clears the stored role (resolves to the "member" default). */
	readonly role: TenantRole | null;
}

/**
 * Tenants domain port — the tenant-scoped facade over the Groups
 * service. Every method is PlatformAdmin-gated by the delegated Groups
 * call; `members`/`addMember`/`removeMember`/`setRole` pin
 * `memberKind === "user"` because only user memberships are tenant
 * memberships (non-user group members are managed on /platform/groups).
 */
export class Tenants extends Context.Service<
	Tenants,
	{
		readonly list: () => Effect.Effect<readonly TenantRow[], Forbidden>;
		readonly members: (tenantId: number) => Effect.Effect<readonly TenantMember[], Forbidden>;
		readonly addMember: (
			input: AddTenantMemberInput,
		) => Effect.Effect<TenantMember | null, Forbidden>;
		readonly removeMember: (
			input: RemoveTenantMemberInput,
		) => Effect.Effect<TenantMember | null, Forbidden>;
		readonly setRole: (
			input: SetTenantMemberRoleInput,
		) => Effect.Effect<TenantMember | null, Forbidden>;
	}
>()("@ktb/tenant-plugin/Tenants") {}

export const TenantsLive = Layer.effect(
	Tenants,
	Effect.gen(function* () {
		const groups = yield* Groups;
		return Tenants.of({
			list: () => groups.list(),
			members: (tenantId) =>
				groups
					.members(tenantId)
					.pipe(Effect.map((rows) => rows.filter((m) => m.memberKind === "user"))),
			addMember: (input) =>
				groups.addMember({
					groupId: input.tenantId,
					memberKind: "user",
					memberId: input.memberId,
					role: input.role ?? null,
				}),
			removeMember: (input) =>
				groups.removeMember({
					groupId: input.tenantId,
					memberKind: "user",
					memberId: input.memberId,
				}),
			setRole: (input) =>
				groups.updateMemberRole({
					groupId: input.tenantId,
					memberKind: "user",
					memberId: input.memberId,
					role: input.role,
				}),
		});
	}),
);

export const tenantServicesPlugin = definePlugin({
	id: "tenant.services",
	// Consumes the Groups service — the dep edge keeps groups.services
	// (and its platform.admin anchor) ordered before this layer.
	requiredDeps: [groupsServicesPlugin.id],
	services: TenantsLive,
});

// Panel (system console) contribution: /platform/tenants is mounted by
// the platform plugin's physical route subtree; this plugin only
// declares the sidebar entry and page descriptor. The dep edge orders
// it after the shell.
export const tenantPanelPlugin = definePlugin({
	id: "tenant.panel",
	requiredDeps: [platformPanelPlugin.id],
	panel: {
		sidebar: [{ to: "/platform/tenants", label: "Tenants", icon: Building2Icon, group: "Access" }],
		pages: [
			{
				id: "tenant.admin",
				path: "/platform/tenants",
				component: TenantsPlatformPage,
				// Cross-owner listing for the console — the service
				// re-checks the PlatformAdmin gate; Forbidden collapses
				// to the same empty table the groups loader returns.
				loader: () =>
					Effect.gen(function* () {
						const tenants = yield* Tenants;
						return yield* tenants
							.list()
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed([] as TenantRow[])));
					}),
			},
		],
	},
});

/** Single-concern plugins contributed by this module — the host
 * discovery contract (`discoverPlugins` reads this export). */
export const plugins: readonly Plugin[] = [tenantServicesPlugin, tenantPanelPlugin];

// Compile-time dep registry: ids declared here are referenceable in
// requiredDeps/optionalDeps of any plugin that imports this module.
declare module "@ktb/kernel" {
	interface PluginRegistry {
		"tenant.services": true;
		"tenant.panel": true;
	}
}
