import type { Patient } from "../index.ts";

export { ageLabel, demographics } from "../record.ts";

/** Social name takes precedence for addressing (BR Decree 8.727/2016; FHIR name.use=usual). */
export const displayName = (p: Pick<Patient, "name" | "socialName">) => p.socialName ?? p.name;

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/);
	const last = parts.length > 1 ? parts[parts.length - 1]! : "";
	return (parts[0]!.charAt(0) + last.charAt(0)).toUpperCase();
}
