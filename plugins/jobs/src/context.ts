import { createContext } from "react";

import type { JobStatusValue } from "@ktbhealth/ui/components/job-status";

/**
 * One row in the console jobs feed. Serializable — the host maps domain
 * rows (e.g. consultations audio pipeline) into this shape and provides
 * it via JobsDataContext; plugin views never call server fns.
 */
export interface ConsoleJob {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly status: JobStatusValue;
	readonly progress?: number | null;
	readonly meta?: string;
	readonly error?: string;
}

/** Jobs feed for the current console session — empty until the host
 * provides data (the platform route loader does). */
export const JobsDataContext = createContext<readonly ConsoleJob[]>([]);
