import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostSpec } from "@ktb/infra-ports";
import { makeOciDeployHost, ociDeployHost } from "./oci.ts";
import { parseDeployOutputs } from "./outputs.ts";
import { specToVars } from "./vars.ts";

const run = <A>(e: Effect.Effect<A, never, unknown>): Promise<A> =>
	Effect.runPromise(e as Effect.Effect<A, never, never>);

const baseSpec: HostSpec = {
	name: "lgtm",
	imageName: "Canonical-Ubuntu-24.04-aarch64-2025.10.0-0",
	sshPublicKeys: ["ssh-ed25519 AAAA test@example"],
};

describe("specToVars", () => {
	it("maps a minimal spec with defaults", () => {
		const vars = specToVars(baseSpec);
		expect(vars).toMatchObject({
			name: "lgtm",
			shape: "VM.Standard.A1.Flex",
			assign_public_ip: false,
			image_name: "Canonical-Ubuntu-24.04-aarch64-2025.10.0-0",
			ssh_public_keys: ["ssh-ed25519 AAAA test@example"],
		});
		// Optional fields stay undefined so tfvars JSON omits them and the
		// module defaults apply.
		expect(vars.region).toBeUndefined();
		expect(vars.compartment_ocid).toBeUndefined();
		expect(vars.user_data).toBeUndefined();
		expect(vars.ocpus).toBeUndefined();
	});

	it("maps a full spec", () => {
		const vars = specToVars({
			...baseSpec,
			region: "sa-saopaulo-1",
			availabilityDomain: "aBCd:SA-SAOPAULO-1-AD-1",
			tenancyOcid: "ocid1.tenancy.oc1..x",
			compartmentOcid: "ocid1.compartment.oc1..x",
			shape: "VM.Standard.E2.1.Micro",
			imageOcid: "ocid1.image.oc1..x",
			userData: "#!/bin/sh\necho hi",
			assignPublicIp: true,
			freeTierOnly: true,
		});
		expect(vars).toMatchObject({
			region: "sa-saopaulo-1",
			availability_domain: "aBCd:SA-SAOPAULO-1-AD-1",
			tenancy_ocid: "ocid1.tenancy.oc1..x",
			compartment_ocid: "ocid1.compartment.oc1..x",
			shape: "VM.Standard.E2.1.Micro",
			image_ocid: "ocid1.image.oc1..x",
			user_data: "#!/bin/sh\necho hi",
			assign_public_ip: true,
			ssh_public_keys: ["ssh-ed25519 AAAA test@example"],
		});
	});

	it("copies sshPublicKeys instead of aliasing the spec array", () => {
		const keys = ["ssh-ed25519 AAAA test@example"];
		const vars = specToVars({ ...baseSpec, sshPublicKeys: keys });
		expect(vars.ssh_public_keys).toEqual(keys);
		expect(vars.ssh_public_keys).not.toBe(keys);
	});

	it("rejects non-free-tier shapes by default", () => {
		expect(() => specToVars({ ...baseSpec, shape: "VM.Standard.E4.Flex" })).toThrow(/freeTierOnly/);
	});

	it("allows non-free-tier shapes when freeTierOnly is false", () => {
		const vars = specToVars({
			...baseSpec,
			shape: "VM.Standard.E4.Flex",
			ocpus: 2,
			memoryInGbs: 16,
			freeTierOnly: false,
		});
		expect(vars.shape).toBe("VM.Standard.E4.Flex");
		expect(vars.ocpus).toBe(2);
		expect(vars.memory_in_gbs).toBe(16);
	});

	it("enforces A1.Flex free-tier limits", () => {
		expect(() => specToVars({ ...baseSpec, ocpus: 5 })).toThrow(/at most 4 OCPUs/);
		expect(() => specToVars({ ...baseSpec, memoryInGbs: 25 })).toThrow(/at most 24 GB/);
	});

	it("does not apply A1 limits to E2.1.Micro", () => {
		const vars = specToVars({ ...baseSpec, shape: "VM.Standard.E2.1.Micro", ocpus: 8 });
		expect(vars.shape).toBe("VM.Standard.E2.1.Micro");
	});

	it("requires an image selector", () => {
		expect(() => specToVars({ name: "x", sshPublicKeys: ["k"] })).toThrow(/imageOcid or imageName/);
	});

	it("requires ssh keys or userData", () => {
		expect(() => specToVars({ name: "x", imageOcid: "ocid1.image.oc1..x" })).toThrow(
			/sshPublicKeys or userData/,
		);
		expect(
			specToVars({ name: "x", imageOcid: "ocid1.image.oc1..x", userData: "echo hi" }),
		).toBeDefined();
	});
});

describe("parseDeployOutputs", () => {
	it("parses instance_id and public_ip", () => {
		const host = parseDeployOutputs(
			JSON.stringify({
				instance_id: { sensitive: false, type: "string", value: "ocid1.instance.oc1..x" },
				public_ip: { sensitive: false, type: "string", value: "203.0.113.10" },
			}),
		);
		expect(host).toEqual({ id: "ocid1.instance.oc1..x", publicIp: "203.0.113.10" });
	});

	it("omits publicIp when null or empty", () => {
		for (const value of [null, "", 0]) {
			const host = parseDeployOutputs(
				JSON.stringify({
					instance_id: { value: "ocid1.instance.oc1..x" },
					public_ip: { value },
				}),
			);
			expect(host.publicIp).toBeUndefined();
		}
	});

	it("throws when instance_id is missing or not a string", () => {
		expect(() => parseDeployOutputs("{}")).toThrow(/instance_id/);
		expect(() => parseDeployOutputs(JSON.stringify({ instance_id: { value: 42 } }))).toThrow(
			/instance_id/,
		);
	});

	it("throws on invalid JSON", () => {
		expect(() => parseDeployOutputs("not json")).toThrow(SyntaxError);
	});
});

describe("ociDeployHost", () => {
	let dir: string;
	let varsFile: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "ktb-oci-test-"));
		varsFile = join(dir, "ktb.tfvars.json");
		// Fake tofu: records invocations, emits canned `output -json`.
		const fake = join(dir, "tofu");
		await writeFile(
			fake,
			[
				"#!/bin/sh",
				'echo "$@" >> "' + join(dir, "calls.log") + '"',
				'if [ "$1" = "output" ]; then',
				'  echo \'{"instance_id":{"sensitive":false,"type":"string","value":"ocid1.instance.oc1..fake"},"public_ip":{"sensitive":false,"type":"string","value":"203.0.113.10"}}\'',
				"fi",
				"exit 0",
				"",
			].join("\n"),
		);
		await chmod(fake, 0o755);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("is a DeployHost function", () => {
		expect(typeof ociDeployHost).toBe("function");
	});

	it("runs init → apply → output and returns the deployed host", async () => {
		const deploy = makeOciDeployHost({
			tofuBin: join(dir, "tofu"),
			moduleDir: dir,
			stateFile: join(dir, "state.tfstate"),
			varsFile,
		});
		const host = await run(deploy(baseSpec));
		expect(host).toEqual({ id: "ocid1.instance.oc1..fake", publicIp: "203.0.113.10" });

		const log = await readFile(join(dir, "calls.log"), "utf8");
		expect(log).toContain("init -input=false -no-color -backend-config=path=");
		expect(log).toContain("apply -auto-approve -input=false -no-color -var-file=");
		expect(log).toContain("output -json");

		const written = JSON.parse(await readFile(varsFile, "utf8")) as Record<string, unknown>;
		expect(written).toMatchObject({
			name: "lgtm",
			shape: "VM.Standard.A1.Flex",
			assign_public_ip: false,
		});
	});

	it("dies on invalid spec before invoking tofu", async () => {
		const deploy = makeOciDeployHost({ tofuBin: join(dir, "tofu"), moduleDir: dir });
		await expect(run(deploy({ name: "bad" }))).rejects.toThrow(/imageOcid or imageName/);
	});
});
