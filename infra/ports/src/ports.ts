import type * as Effect from "effect/Effect";

/** What the app asks for. Provider-agnostic deploy specs. */

export interface StaticSiteSpec {
	readonly name: string;
	/** Shell command that produces `outdir`. Provider supplies a default. */
	readonly command?: string;
	readonly outdir: string;
}

export interface WorkerSpec extends StaticSiteSpec {
	/**
	 * Worker entrypoint path or file:// URL. With `bundle: false` it must
	 * point at a complete, runtime-ready ESM module produced by the build.
	 */
	readonly main: string;
	/**
	 * When false, `main` and sibling modules upload byte-for-byte with no
	 * bundling (Wrangler's `no_bundle` contract). Default: provider bundles.
	 */
	readonly bundle?: boolean;
	readonly bindings?: Record<string, unknown>;
	readonly compatibilityFlags?: readonly string[];
}

export interface SqlDatabaseSpec {
	readonly name: string;
	readonly migrationsDir?: string;
}

/**
 * What the app asks for when it needs a VM/bare host (e.g. the LGTM
 * observability backend). Fields named after a provider concept
 * (compartment/tenancy OCIDs) are only read by adapters that need them;
 * other providers ignore them.
 */
export interface HostSpec {
	readonly name: string;
	/** OCI region identifier (e.g. "sa-saopaulo-1"). Optional: provider default. */
	readonly region?: string;
	/** Availability domain name (e.g. "aBCd:..."). Optional: provider picks one. */
	readonly availabilityDomain?: string;
	/** OCI compartment OCID that owns the host. Optional: provider env/default. */
	readonly compartmentOcid?: string;
	/** OCI tenancy OCID — needed to resolve an availability domain by name. */
	readonly tenancyOcid?: string;
	/** Compute shape. Default "VM.Standard.A1.Flex" (Always Free). */
	readonly shape?: string;
	/** Flex-shape OCPUs (ignored by fixed shapes like E2.1.Micro). */
	readonly ocpus?: number;
	/** Flex-shape memory in GB (ignored by fixed shapes). */
	readonly memoryInGbs?: number;
	/** Boot image OCID. Takes precedence over imageName when both are set. */
	readonly imageOcid?: string;
	/** Boot image display name resolved through the provider's image catalog. */
	readonly imageName?: string;
	/** SSH public keys installed at first boot. Required unless userData grants access. */
	readonly sshPublicKeys?: readonly string[];
	/** Optional cloud-init/user-data script or cloud-config document. */
	readonly userData?: string;
	/** Assign an ephemeral public IPv4. Default false (tunnel-only hosts). */
	readonly assignPublicIp?: boolean;
	/**
	 * Restrict to Oracle Always-Free shapes ("VM.Standard.A1.Flex",
	 * "VM.Standard.E2.1.Micro") and free-tier limits. Default true.
	 */
	readonly freeTierOnly?: boolean;
}

/**
 * What a provider hands back. The url/db/id handles are opaque: Alchemy
 * resolves its `Output<T>` at deploy time, another provider may hand a
 * plain value. The port deliberately exposes neither.
 */
export interface DeployedSite {
	readonly url: unknown;
}

export interface DeployedWorker {
	readonly url: unknown;
	/** Worker script name — needed to attach queue consumers. Opaque handle
	 * (may be a provider Output resolved at deploy time). */
	readonly scriptName?: unknown;
}

export interface DeployedSqlDatabase {
	readonly db: unknown;
}

export interface DeployedHost {
	/** Compute instance OCID — opaque handle (may be a provider Output). */
	readonly id: unknown;
	/** Public IPv4 when the host was provisioned with one; absent otherwise. */
	readonly publicIp?: unknown;
}

/** Provider ports. `R` is the provider services the stack wires via `providers:`. */
export type DeployStaticSite<R = never> = (
	spec: StaticSiteSpec,
) => Effect.Effect<DeployedSite, never, R>;

export type DeployWorker<R = never> = (spec: WorkerSpec) => Effect.Effect<DeployedWorker, never, R>;

export type DeploySqlDatabase<R = never> = (
	spec: SqlDatabaseSpec,
) => Effect.Effect<DeployedSqlDatabase, never, R>;

export type DeployHost<R = never> = (spec: HostSpec) => Effect.Effect<DeployedHost, never, R>;
