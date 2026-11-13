terraform {
  required_version = ">= 1.9.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.0"
    }
  }

  # State backend: local state (default, terraform.tfstate next to this
  # file) is the right choice for a single Always-Free VM — see
  # infra/lgtm/README.md "IaC". When the host count grows or state must
  # survive machine loss, switch to the OCI Object Storage backend:
  #
  #   backend "s3" {
  #     bucket = "<ktb-terraform-state>"
  #     key    = "lgtm/terraform.tfstate"
  #     region = "<region>"
  #     # endpoints/endpoints-style S3-compat config for OCI OS
  #   }
  #
  # OCI Object Storage is S3-compatible; the hashicorp/s3 backend works
  # with the right endpoint overrides. Wire via `tofu init -backend-config`.
}

# Credentials come from the environment or ~/.oci/config — the provider
# resolves them itself (API signing key, instance principals, or
# OCI_CLI_AUTH). Never commit keys; region falls back to the profile/env
# when var.region is unset.
provider "oci" {
  region = var.region
}
