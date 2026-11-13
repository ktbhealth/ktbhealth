// OCI OpenTofu implementation of the infra ports (@ktb/infra-ports, P-068).
// Swap providers by importing a different adapter package instead.
export { makeOciDeployHost, ociDeployHost, ociDeployHost as deployHost } from "./oci.ts";
export { parseDeployOutputs } from "./outputs.ts";
export { DEFAULT_SHAPE, FREE_TIER_SHAPES, specToVars } from "./vars.ts";
export type { OciTofuOptions } from "./oci.ts";
export type { DeployHost, DeployedHost, HostSpec } from "@ktb/infra-ports";
