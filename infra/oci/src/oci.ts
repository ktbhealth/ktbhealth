import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import type { DeployHost } from "@ktb/infra-ports";
import { parseDeployOutputs } from "./outputs.ts";
import { specToVars } from "./vars.ts";

/**
 * OpenTofu adapter for the DeployHost port (@ktb/infra-ports, P-068).
 *
 * Each call runs `tofu init` → writes a generated tfvars JSON →
 * `tofu apply -auto-approve` → `tofu output -json` against the module in
 * `infra/oci/tofu`. One adapter instance maps to one tofu state (one
 * host); instantiate `makeOciDeployHost` per host or per state file.
 *
 * State backend: local state (`terraform.tfstate` next to the module,
 * gitignored) is the default — right for a single Always-Free VM. When
 * the host count grows or state must survive machine loss, point
 * `stateFile` at an OCI Object Storage backend configured in the module
 * (see tofu/versions.tf comment) — a human decision, not wired yet.
 *
 * Credentials: the oracle/oci provider reads them from the environment
 * or `~/.oci/config` (API signing key or `OCI_CLI_AUTH`). Nothing secret
 * is stored in this package or the tfvars file.
 */

export interface OciTofuOptions {
	/** tofu binary; default "tofu" (must be on PATH). */
	readonly tofuBin?: string;
	/** Directory containing the *.tf module. Default: <pkg>/tofu. */
	readonly moduleDir?: string;
	/**
	 * Local-backend state file, passed to `tofu init` as
	 * `-backend-config=path=...`. Default: <moduleDir>/terraform.tfstate.
	 */
	readonly stateFile?: string;
	/**
	 * Where the generated tfvars JSON is written. Default:
	 * <dirname(stateFile)>/ktb.tfvars.json (gitignored).
	 */
	readonly varsFile?: string;
}

const DEFAULT_MODULE_DIR = fileURLToPath(new URL("../tofu/", import.meta.url));

interface TofuResult {
	readonly stdout: string;
	readonly stderr: string;
}

const execTofu = (bin: string, args: readonly string[], cwd: string): Promise<TofuResult> =>
	new Promise((resolve, reject) => {
		const child = spawn(bin, [...args], { cwd });
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
						`tofu ${args.join(" ")} exited with code ${code}\n${stderr.trim() || stdout.trim()}`,
					),
				);
			}
		});
	});

export const makeOciDeployHost = (options: OciTofuOptions = {}): DeployHost<never> =>
	Effect.fnUntraced(function* (spec) {
		const vars = yield* Effect.sync(() => specToVars(spec));
		const bin = options.tofuBin ?? "tofu";
		const moduleDir = options.moduleDir ?? DEFAULT_MODULE_DIR;
		const stateFile = options.stateFile ?? join(moduleDir, "terraform.tfstate");
		const varsFile = options.varsFile ?? join(dirname(stateFile), "ktb.tfvars.json");

		yield* Effect.promise(() =>
			execTofu(
				bin,
				["init", "-input=false", "-no-color", `-backend-config=path=${stateFile}`],
				moduleDir,
			),
		);
		yield* Effect.promise(() => writeFile(varsFile, `${JSON.stringify(vars, null, 2)}\n`));
		yield* Effect.promise(() =>
			execTofu(
				bin,
				["apply", "-auto-approve", "-input=false", "-no-color", `-var-file=${varsFile}`],
				moduleDir,
			),
		);
		const { stdout } = yield* Effect.promise(() => execTofu(bin, ["output", "-json"], moduleDir));
		return yield* Effect.sync(() => parseDeployOutputs(stdout));
	});

/** Default adapter: bundled tofu/ module, local state, `tofu` on PATH. */
export const ociDeployHost: DeployHost<never> = makeOciDeployHost();
