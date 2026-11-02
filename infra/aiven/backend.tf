# Remote state in Cloudflare R2. Endpoint: AWS_ENDPOINT_URL_S3. Credentials: AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY (R2 token id / SHA-256 of token value). See docs/runbooks/bootstrap-state.md.
terraform {
  backend "s3" {
    bucket = "cerorag-tfstate"
    key    = "aiven/terraform.tfstate"
    region = "auto"

    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}
