import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostSpec } from "@ktb/infra-ports";
import { makeOciDeployHost, ociDeployHost } from "./oci.ts";
import { parseDeployOutputs } from "./outputs.ts";
import { specToDeploySpec } from "./spec.ts";

const run = <A>(e: Effect.Effect<A, never, unknown>): Promise<A> =>
	Effect.runPromise(e as Effect.Effect<A, never, never>);

const baseSpec: HostSpec = {
	name: "lgtm",
	compartmentOcid: "ocid1.compartment.oc1..x",
	availabilityDomain: "aBCd:SA-SAOPAULO-1-AD-1",
	imageName: "Canonical-Ubuntu-24.04-aarch64-2025.10.0-0",
	sshPublicKeys: ["ssh-ed25519 AAAA test@example"],
};

describe("specToDeploySpec", () => {
	it("maps a minimal spec with defaults", () => {
		const spec = specToDeploySpec(baseSpec);
		expect(spec).toMatchObject({
			name: "lgtm",
			compartmentOcid: "ocid1.compartment.oc1..x",
			availabilityDomain: "aBCd:SA-SAOPAULO-1-AD-1",
			shape: "VM.Standard.A1.Flex",
			assignPublicIp: false,
			imageName: "Canonical-Ubuntu-24.04-aarch64-2025.10.0-0",
			sshPublicKeys: ["ssh-ed25519 AAAA test@example"],
			vcnCidr: "10.0.0.0/16",
			sshIngressCidr: "0.0.0.0/0",
		});
		// Optional fields stay undefined so the spec JSON omits them and
		// the program defaults apply.
		expect(spec.region).toBeUndefined();
		expect(spec.tenancyOcid).toBeUndefined();
		expect(spec.userData).toBeUndefined();
		expect(spec.ocpus).toBeUndefined();
	});

	it("maps a full spec", () => {
		const spec = specToDeploySpec({
			...baseSpec,
			region: "sa-saopaulo-1",
			tenancyOcid: "ocid1.tenancy.oc1..x",
			shape: "VM.Standard.E2.1.Micro",
			imageOcid: "ocid1.image.oc1..x",
			userData: "#!/bin/sh\necho hi",
			assignPublicIp: true,
			freeTierOnly: true,
		});
		expect(spec).toMatchObject({
			region: "sa-saopaulo-1",
			tenancyOcid: "ocid1.tenancy.oc1..x",
			shape: "VM.Standard.E2.1.Micro",
			imageOcid: "ocid1.image.oc1..x",
			userData: "#!/bin/sh\necho hi",
			assignPublicIp: true,
			sshPublicKeys: ["ssh-ed25519 AAAA test@example"],
		});
	});

	it("copies sshPublicKeys instead of aliasing the spec array", () => {
		const keys = ["ssh-ed25519 AAAA test@example"];
		const spec = specToDeploySpec({ ...baseSpec, sshPublicKeys: keys });
		expect(spec.sshPublicKeys).toEqual(keys);
		expect(spec.sshPublicKeys).not.toBe(keys);
	});

	it("rejects non-free-tier shapes by default", () => {
		expect(() => specToDeploySpec({ ...baseSpec, shape: "VM.Standard.E4.Flex" })).toThrow(
			/freeTierOnly/,
		);
	});

	it("allows non-free-tier shapes when freeTierOnly is false", () => {
		const spec = specToDeploySpec({
			...baseSpec,
			shape: "VM.Standard.E4.Flex",
			ocpus: 2,
			memoryInGbs: 16,
			freeTierOnly: false,
		});
		expect(spec.shape).toBe("VM.Standard.E4.Flex");
		expect(spec.ocpus).toBe(2);
		expect(spec.memoryInGbs).toBe(16);
	});

	it("enforces A1.Flex free-tier limits", () => {
		expect(() => specToDeploySpec({ ...baseSpec, ocpus: 5 })).toThrow(/at most 4 OCPUs/);
		expect(() => specToDeploySpec({ ...baseSpec, memoryInGbs: 25 })).toThrow(/at most 24 GB/);
	});

	it("does not apply A1 limits to E2.1.Micro", () => {
		const spec = specToDeploySpec({
			...baseSpec,
			shape: "VM.Standard.E2.1.Micro",
			ocpus: 8,
		});
		expect(spec.shape).toBe("VM.Standard.E2.1.Micro");
	});

	it("requires a compartment OCID", () => {
		const { compartmentOcid: _omit, ...rest } = baseSpec;
		expect(() => specToDeploySpec(rest)).toThrow(/compartmentOcid/);
	});

	it("requires availabilityDomain or tenancyOcid", () => {
		const { availabilityDomain: _omit, ...rest } = baseSpec;
		expect(() => specToDeploySpec(rest)).toThrow(/availabilityDomain or tenancyOcid/);
		// tenancyOcid alone is enough — the program resolves the first AD.
		expect(specToDeploySpec({ ...rest, tenancyOcid: "ocid1.tenancy.oc1..x" })).toBeDefined();
	});

	it("requires an image selector", () => {
		expect(() =>
			specToDeploySpec({ name: "x", compartmentOcid: "c", availabilityDomain: "ad" }),
		).toThrow(/imageOcid or imageName/);
	});

	it("requires ssh keys or userData", () => {
		expect(() =>
			specToDeploySpec({
				name: "x",
				compartmentOcid: "c",
				availabilityDomain: "ad",
				imageOcid: "ocid1.image.oc1..x",
			}),
		).toThrow(/sshPublicKeys or userData/);
		expect(
			specToDeploySpec({
				name: "x",
				compartmentOcid: "c",
				availabilityDomain: "ad",
				imageOcid: "ocid1.image.oc1..x",
				userData: "echo hi",
			}),
		).toBeDefined();
	});
});

describe("parseDeployOutputs", () => {
	it("parses instanceId and publicIp", () => {
		const host = parseDeployOutputs(
			JSON.stringify({
				instanceId: "ocid1.instance.oc1..x",
				publicIp: "203.0.113.10",
			}),
		);
		expect(host).toEqual({ id: "ocid1.instance.oc1..x", publicIp: "203.0.113.10" });
	});

	it("omits publicIp when absent, null or empty", () => {
		for (const outputs of [
			{ instanceId: "ocid1.instance.oc1..x" },
			{ instanceId: "ocid1.instance.oc1..x", publicIp: null },
			{ instanceId: "ocid1.instance.oc1..x", publicIp: "" },
			{ instanceId: "ocid1.instance.oc1..x", publicIp: 0 },
		]) {
			const host = parseDeployOutputs(JSON.stringify(outputs));
			expect(host.publicIp).toBeUndefined();
		}
	});

	it("throws when instanceId is missing or not a string", () => {
		expect(() => parseDeployOutputs("{}")).toThrow(/instanceId/);
		expect(() => parseDeployOutputs(JSON.stringify({ instanceId: 42 }))).toThrow(/instanceId/);
	});

	it("throws on invalid JSON", () => {
		expect(() => parseDeployOutputs("not json")).toThrow(SyntaxError);
	});
});

describe("ociDeployHost", () => {
	let dir: string;
	let specFile: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "ktb-oci-test-"));
		specFile = join(dir, "ktb.spec.json");
		// Fake pulumi: records invocations, emits canned `stack output --json`.
		const fake = join(dir, "pulumi");
		await writeFile(
			fake,
			[
				"#!/bin/sh",
				'echo "$@" >> "' + join(dir, "calls.log") + '"',
				'if [ "$1" = "stack" ] && [ "$2" = "output" ]; then',
				'  echo \'{"instanceId":"ocid1.instance.oc1..fake","publicIp":"203.0.113.10"}\'',
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

	it("runs stack select --create → up → stack output and returns the host", async () => {
		const deploy = makeOciDeployHost({
			pulumiBin: join(dir, "pulumi"),
			programDir: dir,
			specFile,
		});
		const host = await run(deploy(baseSpec));
		expect(host).toEqual({ id: "ocid1.instance.oc1..fake", publicIp: "203.0.113.10" });

		const log = await readFile(join(dir, "calls.log"), "utf8");
		expect(log).toContain("stack select --create dev --non-interactive");
		expect(log).toContain("up --yes --non-interactive --stack dev");
		expect(log).toContain("stack output --json --stack dev");

		const written = JSON.parse(await readFile(specFile, "utf8")) as Record<string, unknown>;
		expect(written).toMatchObject({
			name: "lgtm",
			compartmentOcid: "ocid1.compartment.oc1..x",
			shape: "VM.Standard.A1.Flex",
			assignPublicIp: false,
			vcnCidr: "10.0.0.0/16",
		});
	});

	it("honours stack and passphrase options", async () => {
		const deploy = makeOciDeployHost({
			pulumiBin: join(dir, "pulumi"),
			programDir: dir,
			specFile,
			stack: "lgtm",
			passphrase: "test-passphrase",
		});
		await run(deploy(baseSpec));
		const log = await readFile(join(dir, "calls.log"), "utf8");
		expect(log).toContain("stack select --create lgtm --non-interactive");
		expect(log).toContain("--stack lgtm");
	});

	it("dies on invalid spec before invoking pulumi", async () => {
		const deploy = makeOciDeployHost({ pulumiBin: join(dir, "pulumi"), programDir: dir });
		await expect(run(deploy({ name: "bad" }))).rejects.toThrow(/invalid HostSpec/);
	});
});
