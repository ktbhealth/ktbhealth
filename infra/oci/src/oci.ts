import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import type { DeployHost } from "@ktb/infra-ports";
import { parseDeployOutputs } from "./outputs.ts";
import { specToDeploySpec } from "./spec.ts";

/**
 * Pulumi adapter for the DeployHost port (@ktb/infra-ports, P-068/T-114).
 *
 * Each call validates the HostSpec, writes it as JSON, then runs
 * `pulumi stack select --create` → `pulumi up --yes` →
 * `pulumi stack output --json` against the program in `infra/oci/pulumi`
 * (@pulumi/oci — the Terraform-bridge provider, full oracle/oci
 * coverage). One adapter instance maps to one Pulumi stack (one host);
 * instantiate `makeOciDeployHost` per host or per `stack`/`specFile`.
 *
 * State backend: whatever `pulumi login` selected — the default local
 * file backend (file://~) keeps checkpoints under ~/.pulumi, which is
 * right for a single Always-Free VM. Pulumi Cloud or a DIY backend
 * (e.g. S3-compatible OCI Object Storage via `pulumi login s3://…`)
 * is a human decision, not wired here — see infra/lgtm/README.md.
 *
 * Credentials: the oci provider plugin reads them from the environment
 * or `~/.oci/config` (API signing key or OCI_CLI_AUTH) — same contract
 * the oracle/oci Terraform provider had. Stack secrets use the
 * passphrase secrets provider; set `passphrase` or
 * PULUMI_CONFIG_PASSPHRASE before the first deploy.
 *
 * The Pulumi program's npm deps are not a workspace member — run
 * `bun install` inside infra/oci/pulumi once before the first deploy.
 */

export interface OciPulumiOptions {
	/** pulumi binary; default "pulumi" (must be on PATH). */
	readonly pulumiBin?: string;
	/** Directory containing Pulumi.yaml + index.ts. Default: <pkg>/pulumi. */
	readonly programDir?: string;
	/** Pulumi stack name; created on first use. Default "dev". */
	readonly stack?: string;
	/**
	 * Where the generated spec JSON is written; the program reads it via
	 * KTB_HOST_SPEC_FILE. Default: <programDir>/ktb.spec.json (gitignored).
	 */
	readonly specFile?: string;
	/**
	 * Passphrase for the stack secrets provider, exported as
	 * PULUMI_CONFIG_PASSPHRASE for every pulumi invocation. Only needed
	 * on first `stack select --create`; harmless afterwards. Falls back
	 * to the ambient environment when unset.
	 */
	readonly passphrase?: string;
}

const DEFAULT_PROGRAM_DIR = fileURLToPath(new URL("../pulumi/", import.meta.url));

interface PulumiResult {
	readonly stdout: string;
	readonly stderr: string;
}

const execPulumi = (
	bin: string,
	args: readonly string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<PulumiResult> =>
	new Promise((resolve, reject) => {
		const child = spawn(bin, [...args], { cwd, env });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(
					new Error(
						`pulumi ${args.join(" ")} exited with code ${code}\n${stderr.trim() || stdout.trim()}`,
					),
				);
			}
		});
	});

export const makeOciDeployHost = (options: OciPulumiOptions = {}): DeployHost<never> =>
	Effect.fnUntraced(function* (spec) {
		const deploySpec = yield* Effect.sync(() => specToDeploySpec(spec));
		const bin = options.pulumiBin ?? "pulumi";
		const programDir = options.programDir ?? DEFAULT_PROGRAM_DIR;
		const stack = options.stack ?? "dev";
		const specFile = options.specFile ?? join(programDir, "ktb.spec.json");

		yield* Effect.promise(() => writeFile(specFile, `${JSON.stringify(deploySpec, null, 2)}\n`));

		const env: NodeJS.ProcessEnv = {
			...process.env,
			KTB_HOST_SPEC_FILE: specFile,
			...(options.passphrase === undefined ? {} : { PULUMI_CONFIG_PASSPHRASE: options.passphrase }),
		};

		// Create the stack on first use; select is a no-op afterwards.
		yield* Effect.promise(() =>
			execPulumi(bin, ["stack", "select", "--create", stack, "--non-interactive"], programDir, env),
		);
		yield* Effect.promise(() =>
			execPulumi(bin, ["up", "--yes", "--non-interactive", "--stack", stack], programDir, env),
		);
		const { stdout } = yield* Effect.promise(() =>
			execPulumi(bin, ["stack", "output", "--json", "--stack", stack], programDir, env),
		);
		return yield* Effect.sync(() => parseDeployOutputs(stdout));
	});

/** Default adapter: bundled pulumi/ program, "dev" stack, `pulumi` on PATH. */
export const ociDeployHost: DeployHost<never> = makeOciDeployHost();
