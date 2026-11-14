// Compat shim (P-074 phase 2a): the domain schema moved to
// @ktb/eval-consult — re-exported so `@ktb/eval-dataset/schema` keeps
// its surface (it already re-exports the @ktb/eval-core contracts).
export * from "@ktb/eval-consult/schema";
