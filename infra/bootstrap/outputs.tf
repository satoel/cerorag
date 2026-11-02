# S3 credentials for R2 are derived from the API token:
# access key id = token id, secret = SHA-256 of the token value.
output "state_endpoint" {
  description = "S3 endpoint for the state bucket (use as AWS_ENDPOINT_URL_S3)."
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
}

output "state_bucket" {
  value = cloudflare_r2_bucket.state.name
}

output "admin_bucket" {
  value = cloudflare_r2_bucket.admin.name
}

output "state_admin_access_key_id" {
  value     = cloudflare_account_token.state_admin.id
  sensitive = true
}

output "state_admin_secret_access_key" {
  value     = sha256(cloudflare_account_token.state_admin.value)
  sensitive = true
}

output "state_rw_access_key_id" {
  value     = cloudflare_account_token.state_rw.id
  sensitive = true
}

output "state_rw_secret_access_key" {
  value     = sha256(cloudflare_account_token.state_rw.value)
  sensitive = true
}

output "state_ro_access_key_id" {
  value     = cloudflare_account_token.state_ro.id
  sensitive = true
}

output "state_ro_secret_access_key" {
  value     = sha256(cloudflare_account_token.state_ro.value)
  sensitive = true
}

output "quota_monitor_token" {
  description = "Account Analytics Read token for the quota-monitor Worker (wrangler secret put CF_ANALYTICS_TOKEN)."
  value       = cloudflare_account_token.quota_monitor.value
  sensitive   = true
}
