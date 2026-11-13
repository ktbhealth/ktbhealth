# infra/oci — VCN + public subnet + security list + compute instance.
# Free-tier shapes only unless the caller overrides (the adapter enforces
# this; the module itself trusts its inputs).

locals {
  is_flex_shape = contains([
    "VM.Standard.A1.Flex",
    "VM.Standard.A2.Flex",
    "VM.Standard.E3.Flex",
    "VM.Standard.E4.Flex",
    "VM.Standard.E5.Flex",
  ], var.shape)

  # Boot image: explicit OCID wins; otherwise resolve image_name (exact
  # display-name match, newest first) — or, when both are empty, the
  # newest AVAILABLE image for the shape in the compartment.
  image_ocid = var.image_ocid != "" ? var.image_ocid : data.oci_core_images.selected[0].id

  availability_domain = var.availability_domain != null ? var.availability_domain : data.oci_identity_availability_domains.ads[0].name

  metadata = merge(
    length(var.ssh_public_keys) > 0 ? { ssh_authorized_keys = join("\n", var.ssh_public_keys) } : {},
    var.user_data != "" ? { user_data = base64encode(var.user_data) } : {},
  )
}

# Only read when availability_domain is not given explicitly.
data "oci_identity_availability_domains" "ads" {
  count          = var.availability_domain != null ? 0 : 1
  compartment_id = var.tenancy_ocid
}

# Only read when image_ocid is not given explicitly.
data "oci_core_images" "selected" {
  count          = var.image_ocid != "" ? 0 : 1
  compartment_id = var.compartment_ocid
  display_name   = var.image_name != "" ? var.image_name : null
  shape          = var.shape
  state          = "AVAILABLE"
  sort_by        = "TIMECREATED"
  sort_order     = "DESC"
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${var.name}-vcn"
  freeform_tags  = { Name = var.name }
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-igw"
  enabled        = true
}

resource "oci_core_route_table" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this.id
  }
}

# Security lists are VCN-scoped in OCI (they apply to every subnet in the
# VCN); NSGs are the per-VNIC alternative if finer granularity is needed.
resource "oci_core_security_list" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # SSH only; everything else stays closed. Widen deliberately if needed.
  ingress_security_rules {
    source    = var.ssh_ingress_cidr
    protocol  = "6" # TCP
    tcp_options {
      destination_port_range {
        min = 22
        max = 22
      }
    }
  }
}

resource "oci_core_subnet" "this" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 8, 0)
  display_name               = "${var.name}-subnet"
  route_table_id             = oci_core_route_table.this.id
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_ocid
  availability_domain = local.availability_domain
  shape               = var.shape
  display_name        = var.name
  freeform_tags       = { Name = var.name }

  # shape_config is only valid for flexible shapes; fixed shapes like
  # VM.Standard.E2.1.Micro reject it.
  dynamic "shape_config" {
    for_each = local.is_flex_shape ? [1] : []
    content {
      ocpus         = var.ocpus
      memory_in_gbs = var.memory_in_gbs
    }
  }

  source_details {
    source_type = "image"
    source_id   = local.image_ocid
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.this.id
    assign_public_ip = var.assign_public_ip
    display_name     = "${var.name}-vnic"
  }

  metadata = local.metadata
}
