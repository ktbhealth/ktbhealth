import type { HostSpec } from "@ktb/infra-ports";

/**
 * HostSpec → deploy spec for the Pulumi program in infra/oci/pulumi.
 *
 * The result is written as JSON (KTB_HOST_SPEC_FILE) and read by
 * pulumi/index.ts at program-eval time. `undefined` entries are dropped
 * by JSON.stringify, so the program applies its own defaults.
 */

export const DEFAULT_SHAPE = "VM.Standard.A1.Flex";

/** Oracle Always-Free eligible shapes (per P-068 / infra/lgtm README). */
export const FREE_TIER_SHAPES = ["VM.Standard.A1.Flex", "VM.Standard.E2.1.Micro"] as const;

const FREE_TIER_SHAPE_SET: ReadonlySet<string> = new Set(FREE_TIER_SHAPES);

/** A1.Flex Always-Free ceiling: 4 OCPU / 24 GB per availability domain. */
const A1_MAX_OCPUS = 4;
const A1_MAX_MEMORY_GBS = 24;

/** Same defaults the OpenTofu module exposed as variables. */
const DEFAULT_VCN_CIDR = "10.0.0.0/16";
const DEFAULT_SSH_INGRESS_CIDR = "0.0.0.0/0";

/**
 * The JSON document written to the spec file and consumed by
 * infra/oci/pulumi/index.ts. camelCase mirrors HostSpec; the Pulumi
 * program maps it onto @pulumi/oci resource args.
 */
export interface DeploySpec {
	readonly name: string;
	readonly region?: string;
	readonly availabilityDomain?: string;
	readonly tenancyOcid?: string;
	readonly compartmentOcid: string;
	readonly shape: string;
	readonly ocpus?: number;
	readonly memoryInGbs?: number;
	readonly imageOcid?: string;
	readonly imageName?: string;
	readonly sshPublicKeys?: readonly string[];
	readonly userData?: string;
	readonly assignPublicIp: boolean;
	readonly vcnCidr: string;
	readonly sshIngressCidr: string;
}

const invariant: (cond: boolean, message: string) => asserts cond = (cond, message) => {
	if (!cond) {
		throw new Error(`invalid HostSpec: ${message}`);
	}
};

export function specToDeploySpec(spec: HostSpec): DeploySpec {
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
		spec.compartmentOcid !== undefined,
		"compartmentOcid is required (the OCI provider has no env default for it)",
	);
	invariant(
		spec.availabilityDomain !== undefined || spec.tenancyOcid !== undefined,
		"availabilityDomain or tenancyOcid is required to place the instance",
	);
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
		availabilityDomain: spec.availabilityDomain,
		tenancyOcid: spec.tenancyOcid,
		compartmentOcid: spec.compartmentOcid,
		shape,
		ocpus: spec.ocpus,
		memoryInGbs: spec.memoryInGbs,
		imageOcid: spec.imageOcid,
		imageName: spec.imageName,
		sshPublicKeys: spec.sshPublicKeys === undefined ? undefined : [...spec.sshPublicKeys],
		userData: spec.userData,
		assignPublicIp: spec.assignPublicIp ?? false,
		vcnCidr: DEFAULT_VCN_CIDR,
		sshIngressCidr: DEFAULT_SSH_INGRESS_CIDR,
	};
}
