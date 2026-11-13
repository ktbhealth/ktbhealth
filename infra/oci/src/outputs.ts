import type { DeployedHost } from "@ktb/infra-ports";

/**
 * Parses `tofu output -json` into a DeployedHost.
 *
 * Shape: `{ "<name>": { "sensitive": bool, "type": string, "value": any } }`.
 * The module exposes `instance_id` (always) and `public_ip` (null when the
 * host has no public IP).
 */

interface TofuOutput {
	readonly sensitive?: boolean;
	readonly type?: string;
	readonly value?: unknown;
}

export function parseDeployOutputs(json: string): DeployedHost {
	const outputs = JSON.parse(json) as Record<string, TofuOutput | undefined>;
	const id = outputs.instance_id?.value;
	if (typeof id !== "string" || id === "") {
		throw new Error("tofu output is missing a string instance_id");
	}
	const publicIp = outputs.public_ip?.value;
	return {
		id,
		publicIp: typeof publicIp === "string" && publicIp !== "" ? publicIp : undefined,
	};
}
