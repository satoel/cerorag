# Module for provider `cloudflare`. Resources are added in the phase that owns them
# (see the phase plan); provider configuration lands together with the first resource.
terraform {
  required_version = "~> 1.13"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}
