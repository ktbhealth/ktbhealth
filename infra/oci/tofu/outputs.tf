output "instance_id" {
  description = "OCID of the compute instance."
  value       = oci_core_instance.this.id
}

output "public_ip" {
  description = "Public IPv4 of the instance, or null when assign_public_ip is false."
  value       = var.assign_public_ip ? oci_core_instance.this.public_ip : null
}
