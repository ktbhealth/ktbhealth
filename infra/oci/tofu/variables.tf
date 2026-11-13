# infra/oci — single Always-Free-eligible OCI VM (P-068).
#
# Consumed by @ktb/infra-oci (infra/oci/src/oci.ts), which generates a
# tfvars JSON from a HostSpec and runs init/apply/output. It can also be
# driven by hand: `tofu apply -var-file=…`. Keep variable names in sync
# with infra/oci/src/vars.ts.

variable "name" {
  type        = string
  description = "Host name — used in resource display names and tags."
}

variable "region" {
  type        = string
  default     = null
  description = "OCI region identifier (e.g. sa-saopaulo-1). Null = provider default/env."
}

variable "availability_domain" {
  type        = string
  default     = null
  description = "Availability domain name. Null = resolved from tenancy_ocid (first AD)."
}

variable "tenancy_ocid" {
  type        = string
  default     = null
  description = "Tenancy OCID — required to resolve availability_domain when unset."
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID that owns the VCN, subnet and instance."
}

variable "shape" {
  type        = string
  default     = "VM.Standard.A1.Flex"
  description = "Compute shape. Free-tier: VM.Standard.A1.Flex or VM.Standard.E2.1.Micro."
}

variable "ocpus" {
  type        = number
  default     = 1
  description = "OCPUs for flexible shapes (ignored by fixed shapes)."
}

variable "memory_in_gbs" {
  type        = number
  default     = 6
  description = "Memory in GB for flexible shapes (ignored by fixed shapes)."
}

variable "image_ocid" {
  type        = string
  default     = ""
  description = "Boot image OCID. Takes precedence over image_name."
}

variable "image_name" {
  type        = string
  default     = ""
  description = "Boot image display name (exact match) resolved via oci_core_images."
}

variable "ssh_public_keys" {
  type        = list(string)
  default     = []
  description = "SSH public keys installed via cloud-init metadata."
}

variable "user_data" {
  type        = string
  default     = ""
  description = "Optional cloud-init/user-data (plain text; base64-encoded here)."
}

variable "assign_public_ip" {
  type        = bool
  default     = false
  description = "Assign an ephemeral public IPv4 to the instance VNIC."
}

variable "ssh_ingress_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "CIDR allowed to reach TCP/22. Restrict to your IP for hardening."
}

variable "vcn_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VCN CIDR; the public subnet takes the first /24."
}
