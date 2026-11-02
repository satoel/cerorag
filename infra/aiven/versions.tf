# Module for provider `aiven`. Resources are added in the phase that owns them
# (see the phase plan); provider configuration lands together with the first resource.
terraform {
  required_version = "~> 1.13"

  required_providers {
    aiven = {
      source  = "aiven/aiven"
      version = "~> 4.65"
    }
  }
}
