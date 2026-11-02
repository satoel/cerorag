variable "state_passphrase" {
  description = "Passphrase for OpenTofu state/plan encryption (>= 16 chars). Set via TF_VAR_state_passphrase."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "state_passphrase must be at least 16 characters."
  }
}

variable "account_id" {
  description = "Cloudflare account ID. Set via TF_VAR_account_id."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.account_id))
    error_message = "account_id must be a 32-character hex Cloudflare account ID."
  }
}

variable "state_bucket_name" {
  description = "Name of the R2 bucket holding OpenTofu state."
  type        = string
  default     = "quimera-tfstate"
}

variable "state_bucket_location" {
  description = "R2 location hint for the state bucket (best effort, only honored at creation)."
  type        = string
  default     = "enam"

  validation {
    condition     = contains(["apac", "eeur", "enam", "weur", "wnam", "oc"], var.state_bucket_location)
    error_message = "state_bucket_location must be one of apac, eeur, enam, weur, wnam, oc."
  }
}
