import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import * as oci from "@pulumi/oci";

/**
 * Pulumi program for @ktb/infra-oci (DeployHost port, @ktb/infra-ports,
 * P-068 / T-114). Provisions a single OCI VM: VCN + IGW + route table +
 * security list (SSH-only ingress) + public subnet + compute instance.
 *
 * Inputs: the adapter validates a HostSpec and writes it as JSON to the
 * file named by KTB_HOST_SPEC_FILE (default ./ktb.spec.json next to
 * Pulumi.yaml). All OCI credentials come from the environment or
 * ~/.oci/config — same contract the oracle/oci Terraform provider had.
 *
 * State backend: whatever `pulumi login` selected (the default local
 * file backend, file://~, keeps checkpoints under ~/.pulumi). Pulumi
 * Cloud or a DIY backend (e.g. S3-compatible OCI Object Storage) is a
 * human decision — switch with `pulumi login`, nothing here changes.
 */

interface DeploySpec {
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

const specPath = process.env.KTB_HOST_SPEC_FILE ?? "ktb.spec.json";
const spec = JSON.parse(readFileSync(specPath, "utf8")) as DeploySpec;

// Network knobs the HostSpec port does not (yet) expose — same defaults
// the OpenTofu module used.
const VCN_CIDR = spec.vcnCidr || "10.0.0.0/16";
const SSH_INGRESS_CIDR = spec.sshIngressCidr || "0.0.0.0/0";

/** Oracle Always-Free eligible shapes (mirrors infra/oci/src/spec.ts). */
const FLEX_SHAPES = new Set([
	"VM.Standard.A1.Flex",
	"VM.Standard.A2.Flex",
	"VM.Standard.E3.Flex",
	"VM.Standard.E4.Flex",
	"VM.Standard.E5.Flex",
]);

/**
 * cidrsubnet(vcn, 8, 0) equivalent: carve the first /N+8 subnet out of the
 * VCN block (index 0 → host bits zeroed).
 */
const firstSubnetCidr = (vcnCidr: string): string => {
	const [ip, prefixStr] = vcnCidr.split("/");
	const newPrefix = Number(prefixStr) + 8;
	const addr = ip.split(".").reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
	const mask = newPrefix === 0 ? 0 : (0xffffffff << (32 - newPrefix)) >>> 0;
	const subnet = (addr & mask) >>> 0;
	const octets = [24, 16, 8, 0].map((shift) => (subnet >>> shift) & 0xff);
	return `${octets.join(".")}/${newPrefix}`;
};

const provider = new oci.Provider("oci", { region: spec.region });
const providerOpts = { provider };

// Availability domain: explicit spec value wins; otherwise the first AD
// of the tenancy (mirrors the old data.oci_identity_availability_domains).
const availabilityDomain = spec.availabilityDomain
	? pulumi.output(spec.availabilityDomain)
	: pulumi
			.output(
				oci.identity.getAvailabilityDomains({
					compartmentId: spec.tenancyOcid as string,
				}),
			)
			.apply((result) => {
				const name = result.availabilityDomains[0]?.name;
				if (!name) {
					throw new Error("tenancy has no availability domains");
				}
				return name;
			});

// Boot image: explicit OCID wins; otherwise resolve image_name (exact
// display-name match, newest first) — or, when unset, the newest
// AVAILABLE image for the shape in the compartment.
const imageId = spec.imageOcid
	? pulumi.output(spec.imageOcid)
	: pulumi
			.output(
				oci.core.getImages({
					compartmentId: spec.compartmentOcid,
					displayName: spec.imageName || undefined,
					shape: spec.shape,
					state: "AVAILABLE",
					sortBy: "TIMECREATED",
					sortOrder: "DESC",
				}),
			)
			.apply((result) => {
				const id = result.images[0]?.id;
				if (!id) {
					throw new Error(
						`no AVAILABLE image found for shape ${spec.shape}` +
							(spec.imageName ? ` named "${spec.imageName}"` : ""),
					);
				}
				return id;
			});

const vcn = new oci.core.Vcn(
	"vcn",
	{
		compartmentId: spec.compartmentOcid,
		cidrBlocks: [VCN_CIDR],
		displayName: `${spec.name}-vcn`,
		freeformTags: { Name: spec.name },
	},
	providerOpts,
);

const internetGateway = new oci.core.InternetGateway(
	"internet-gateway",
	{
		compartmentId: spec.compartmentOcid,
		vcnId: vcn.id,
		displayName: `${spec.name}-igw`,
		enabled: true,
	},
	providerOpts,
);

const routeTable = new oci.core.RouteTable(
	"route-table",
	{
		compartmentId: spec.compartmentOcid,
		vcnId: vcn.id,
		displayName: `${spec.name}-rt`,
		routeRules: [
			{
				destination: "0.0.0.0/0",
				destinationType: "CIDR_BLOCK",
				networkEntityId: internetGateway.id,
			},
		],
	},
	providerOpts,
);

// Security lists are VCN-scoped in OCI; NSGs are the per-VNIC
// alternative if finer granularity is needed.
const securityList = new oci.core.SecurityList(
	"security-list",
	{
		compartmentId: spec.compartmentOcid,
		vcnId: vcn.id,
		displayName: `${spec.name}-sl`,
		egressSecurityRules: [{ destination: "0.0.0.0/0", protocol: "all" }],
		// SSH only; everything else stays closed. Widen deliberately.
		ingressSecurityRules: [
			{
				source: SSH_INGRESS_CIDR,
				protocol: "6", // TCP
				tcpOptions: { min: 22, max: 22 },
			},
		],
	},
	providerOpts,
);

const subnet = new oci.core.Subnet(
	"subnet",
	{
		compartmentId: spec.compartmentOcid,
		vcnId: vcn.id,
		cidrBlock: firstSubnetCidr(VCN_CIDR),
		displayName: `${spec.name}-subnet`,
		routeTableId: routeTable.id,
		securityListIds: [securityList.id],
		prohibitPublicIpOnVnic: false,
	},
	providerOpts,
);

const isFlexShape = FLEX_SHAPES.has(spec.shape);

const instance = new oci.core.Instance(
	"instance",
	{
		compartmentId: spec.compartmentOcid,
		availabilityDomain,
		shape: spec.shape,
		displayName: spec.name,
		freeformTags: { Name: spec.name },
		// shapeConfig is only valid for flexible shapes; fixed shapes like
		// VM.Standard.E2.1.Micro reject it.
		shapeConfig: isFlexShape
			? { ocpus: spec.ocpus ?? 1, memoryInGbs: spec.memoryInGbs ?? 6 }
			: undefined,
		sourceDetails: { sourceType: "image", sourceId: imageId },
		createVnicDetails: {
			subnetId: subnet.id,
			// Bridge-typed string; "false" is required — the subnet is
			// public, so omitting it would assign an ephemeral public IP.
			assignPublicIp: spec.assignPublicIp ? "true" : "false",
			displayName: `${spec.name}-vnic`,
		},
		metadata: {
			...(spec.sshPublicKeys && spec.sshPublicKeys.length > 0
				? { ssh_authorized_keys: spec.sshPublicKeys.join("\n") }
				: {}),
			...(spec.userData ? { user_data: Buffer.from(spec.userData).toString("base64") } : {}),
		},
	},
	providerOpts,
);

export const instanceId = instance.id;
export const publicIp = spec.assignPublicIp ? instance.publicIp : undefined;
