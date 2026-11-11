// The admin_audit table is host-owned by @ktb/db (same rationale as the
// other plugin tables — defining it here would create a @ktb/db ↔ plugin
// workspace cycle). This module stays as the plugin's `./schema` entry
// point so consumers keep a stable import path.
export { adminAudit } from "@ktb/db/schema";
export type { AdminAudit } from "@ktb/db/schema";
