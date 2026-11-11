// Composed schema: all table slices live here in @ktb/db (host-owned)
// so plugin/package consumers import them from `@ktb/db/schema` —
// defining them in the owning plugin would create a @ktb/db ↔ plugin
// workspace cycle (same rationale as ./plugin-state.ts). Add
// `export *` per domain.
export * from "./patients.ts";
export * from "./consultations.ts";
export * from "./groups.ts";
export * from "./notifications.ts";
export * from "./auth.ts";
export * from "./rbac.ts";
export * from "./audit.ts";
export * from "./plugin-state.ts";
