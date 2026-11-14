// Compat shim (P-074 phase 2a): the generic eval framework lives in
// @ktb/eval-core and the clinical consult domain pack in
// @ktb/eval-consult — both re-exported so `@ktb/eval-dataset` keeps its
// full surface until the adapter packages are rewired (phase 3/4).
export * from "@ktb/eval-core";
export * from "@ktb/eval-consult";
