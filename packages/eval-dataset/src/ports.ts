// Compat shim (P-074 phase 2a): the domain ports moved to
// @ktb/eval-consult — re-exported so `@ktb/eval-dataset/ports` keeps
// its surface (it already re-exports the generic @ktb/eval-core ports).
export * from "@ktb/eval-consult/ports";
