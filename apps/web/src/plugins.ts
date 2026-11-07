import type { Plugin } from "@ktb/kernel";
import { plugin as consultations } from "@ktb/consultations";
import { plugin as patients } from "@ktb/patients";

/** Static plugin registry. Add a workspace plugin here. */
export const plugins: readonly Plugin[] = [patients, consultations];
