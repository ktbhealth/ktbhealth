import type { DeployedHost } from "@ktb/infra-ports";

/**
 * Parses `pulumi stack output --json` into a DeployedHost.
 *
 * Shape: `{ "<name>": <value> }` — plain values, unlike tofu's
 * `{value, type, sensitive}` wrapper. The program exports `instanceId`
 * (always) and `publicIp` (absent when the host has no public IP).
 */

export function parseDeployOutputs(json: string): DeployedHost {
	const outputs = JSON.parse(json) as Record<string, unknown>;
	const id = outputs.instanceId;
	if (typeof id !== "string" || id === "") {
		throw new Error("pulumi stack output is missing a string instanceId");
	}
	const publicIp = outputs.publicIp;
	return {
		id,
		publicIp: typeof publicIp === "string" && publicIp !== "" ? publicIp : undefined,
	};
}
