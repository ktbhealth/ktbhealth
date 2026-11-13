import type { HostSpec } from "@ktb/infra-ports";

/**
 * HostSpec → OpenTofu variable mapping for infra/oci/tofu.
 *
 * The result is written as tfvars JSON (`-var-file`), so values keep
 * their JSON types — `ssh_public_keys` stays a list, `assign_public_ip`
 * a bool. `undefined` entries are dropped by JSON.stringify, letting the
 * module's own defaults apply.
 */

export const DEFAULT_SHAPE = "VM.Standard.A1.Flex";

/** Oracle Always-Free eligible shapes (per P-068 / infra/lgtm README). */
export const FREE_TIER_SHAPES = ["VM.Standard.A1.Flex", "VM.Standard.E2.1.Micro"] as const;

const FREE_TIER_SHAPE_SET: ReadonlySet<string> = new Set(FREE_TIER_SHAPES);

/** A1.Flex Always-Free ceiling: 4 OCPU / 24 GB per availability domain. */
const A1_MAX_OCPUS = 4;
const A1_MAX_MEMORY_GBS = 24;

const invariant = (cond: boolean, message: string): void => {
	if (!cond) {
		throw new Error(`invalid HostSpec: ${message}`);
	}
};

export function specToVars(spec: HostSpec): Record<string, unknown> {
	const shape = spec.shape ?? DEFAULT_SHAPE;
	const freeTierOnly = spec.freeTierOnly ?? true;

	if (freeTierOnly) {
		invariant(
			FREE_TIER_SHAPE_SET.has(shape),
			`shape "${shape}" is not Always-Free eligible ` +
				`(allowed: ${FREE_TIER_SHAPES.join(", ")}); set freeTierOnly: false to override`,
		);
		if (shape === "VM.Standard.A1.Flex") {
			const ocpus = spec.ocpus ?? 1;
			const memory = spec.memoryInGbs ?? 6;
			invariant(ocpus <= A1_MAX_OCPUS, `A1.Flex allows at most ${A1_MAX_OCPUS} OCPUs`);
			invariant(memory <= A1_MAX_MEMORY_GBS, `A1.Flex allows at most ${A1_MAX_MEMORY_GBS} GB`);
		}
	}

	invariant(
		spec.imageOcid !== undefined || spec.imageName !== undefined,
		"imageOcid or imageName is required",
	);
	invariant(
		(spec.sshPublicKeys !== undefined && spec.sshPublicKeys.length > 0) ||
			spec.userData !== undefined,
		"sshPublicKeys or userData is required for first-boot access",
	);

	return {
		name: spec.name,
		region: spec.region,
		availability_domain: spec.availabilityDomain,
		tenancy_ocid: spec.tenancyOcid,
		compartment_ocid: spec.compartmentOcid,
		shape,
		ocpus: spec.ocpus,
		memory_in_gbs: spec.memoryInGbs,
		image_ocid: spec.imageOcid,
		image_name: spec.imageName,
		ssh_public_keys: spec.sshPublicKeys === undefined ? undefined : [...spec.sshPublicKeys],
		user_data: spec.userData,
		assign_public_ip: spec.assignPublicIp ?? false,
	};
}
