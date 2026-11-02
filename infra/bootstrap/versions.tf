# Bootstrap module: creates the R2 bucket that stores every other module's state.
# Starts with local (encrypted) state; see docs/runbooks/bootstrap-state.md to migrate it to R2.
terraform {
  required_version = "~> 1.13"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }
}

# Auth comes from CLOUDFLARE_API_TOKEN (a short-lived bootstrap token, never committed).
provider "cloudflare" {}
