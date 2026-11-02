locals {
  # The bootstrap's own state (which holds the rw token) lives in a separate bucket that
  # CI tokens cannot reach. Only the admin token, kept off GitHub, can read it.
  admin_bucket_name = "${var.state_bucket_name}-admin"

  # Bucket-scoped token resources, see https://developers.cloudflare.com/r2/api/tokens/
  state_bucket_resource = "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${var.state_bucket_name}"
  admin_bucket_resource = "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${local.admin_bucket_name}"

  # The R2 free tier only covers Standard storage. Never change this (zero-charge rule).
  r2_storage_class = "Standard"
}

resource "cloudflare_r2_bucket" "state" {
  account_id    = var.account_id
  name          = var.state_bucket_name
  location      = var.state_bucket_location
  storage_class = local.r2_storage_class

  lifecycle {
    # Losing this bucket loses every module's state. Remove only via the rollback runbook.
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "admin" {
  account_id    = var.account_id
  name          = local.admin_bucket_name
  location      = var.state_bucket_location
  storage_class = local.r2_storage_class

  lifecycle {
    prevent_destroy = true
  }
}

# Guardrail: incomplete multipart uploads still count as stored bytes; abort them after 1 day.
resource "cloudflare_r2_bucket_lifecycle" "state" {
  for_each = {
    state = cloudflare_r2_bucket.state.name
    admin = cloudflare_r2_bucket.admin.name
  }

  account_id  = var.account_id
  bucket_name = each.value

  rules = [
    {
      id      = "abort-incomplete-multipart"
      enabled = true
      conditions = {
        prefix = ""
      }
      abort_multipart_uploads_transition = {
        condition = {
          type    = "Age"
          max_age = 86400
        }
      }
    }
  ]
}

data "cloudflare_account_api_token_permission_groups_list" "r2_item_write" {
  account_id = var.account_id
  name       = urlencode("Workers R2 Storage Bucket Item Write")

  lifecycle {
    postcondition {
      condition     = length(self.result) == 1
      error_message = "Expected exactly one 'Workers R2 Storage Bucket Item Write' permission group."
    }
  }
}

data "cloudflare_account_api_token_permission_groups_list" "r2_item_read" {
  account_id = var.account_id
  name       = urlencode("Workers R2 Storage Bucket Item Read")

  lifecycle {
    postcondition {
      condition     = length(self.result) == 1
      error_message = "Expected exactly one 'Workers R2 Storage Bucket Item Read' permission group."
    }
  }
}

data "cloudflare_account_api_token_permission_groups_list" "analytics_read" {
  account_id = var.account_id
  name       = urlencode("Account Analytics Read")

  lifecycle {
    postcondition {
      condition     = length(self.result) == 1
      error_message = "Expected exactly one 'Account Analytics Read' permission group."
    }
  }
}

# Read-only analytics for apps/worker/quota-monitor (R2 usage via GraphQL). Nothing else.
resource "cloudflare_account_token" "quota_monitor" {
  account_id = var.account_id
  name       = "cerorag-quota-monitor"

  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.analytics_read.result[0].id }]
    resources         = jsonencode({ "com.cloudflare.api.account.${var.account_id}" = "*" })
  }]
}

# Admin bucket only (bootstrap state). Lives in your password manager, never in GitHub.
resource "cloudflare_account_token" "state_admin" {
  account_id = var.account_id
  name       = "cerorag-tfstate-admin"

  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.r2_item_write.result[0].id }]
    resources         = jsonencode({ (local.admin_bucket_resource) = "*" })
  }]
}

# Read/write on the module state bucket only: local admin and the approved `apply` job.
resource "cloudflare_account_token" "state_rw" {
  account_id = var.account_id
  name       = "cerorag-tfstate-rw"

  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.r2_item_write.result[0].id }]
    resources         = jsonencode({ (local.state_bucket_resource) = "*" })
  }]
}

# Read-only on the state bucket: PR `plan` jobs (run with -lock=false, never on forks).
resource "cloudflare_account_token" "state_ro" {
  account_id = var.account_id
  name       = "cerorag-tfstate-ro"

  policies = [{
    effect            = "allow"
    permission_groups = [{ id = data.cloudflare_account_api_token_permission_groups_list.r2_item_read.result[0].id }]
    resources         = jsonencode({ (local.state_bucket_resource) = "*" })
  }]
}
