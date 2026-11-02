#!/usr/bin/env bash
# Zero-charge guardrails (docs/quotas.md, "Regla dura: cero cargos en la tarjeta").
# Fails CI if any OpenTofu code could leave a free tier. R2:
#   - Infrequent Access storage (not covered by the free tier, has retrieval fees)
#   - lifecycle transitions to another storage class
#   - public access (r2.dev managed domain or custom domains): lets anyone burn Class B ops
set -euo pipefail

root="${1:-infra}"
fail=0

check() {
  local pattern="$1" reason="$2" hits
  hits="$(grep -RInE --include='*.tf' "$pattern" "$root" || true)"
  if [[ -n "$hits" ]]; then
    echo "::error::cost guardrail violated: $reason"
    echo "$hits"
    fail=1
  fi
}

check 'InfrequentAccess' 'Infrequent Access storage is not free'
check 'storage_class_transitions' 'storage class transitions leave the free tier'
check 'resource[[:space:]]+"cloudflare_r2_managed_domain"' 'public r2.dev access is forbidden'
check 'resource[[:space:]]+"cloudflare_r2_custom_domain"' 'public custom domains on R2 are forbidden'

# --- OCI (Always Free only; PAYG bills anything else) ---
check 'resource[[:space:]]+"oci_load_balancer' 'OCI load balancers are not used (Tunnel only)'
check 'resource[[:space:]]+"oci_network_load_balancer' 'OCI network load balancers are not used (Tunnel only)'
check 'resource[[:space:]]+"oci_core_volume"' 'extra block volumes would exceed the 200 GB taken by boot volumes'
check 'resource[[:space:]]+"oci_core_internet_gateway"' 'no internet gateway: the VCN is private (NAT egress only)'
check 'vault_type[[:space:]]*=[[:space:]]*"VIRTUAL_PRIVATE"' 'virtual private vaults are paid'
check 'protection_mode[[:space:]]*=[[:space:]]*"HSM"' 'use SOFTWARE keys (free, no key-version limit)'
check 'assign_public_ip[[:space:]]*=[[:space:]]*true' 'no public IPs on OCI instances'

# Only Always Free shapes.
shapes="$(grep -RhoE --include='*.tf' '(node_)?shape[[:space:]]*=[[:space:]]*"[^"]+"' "$root" | sed -E 's/.*"([^"]+)"/\1/' | sort -u || true)"
for s in $shapes; do
  case "$s" in
    VM.Standard.A1.Flex|VM.Standard.E2.1.Micro) ;;
    *) echo "::error::cost guardrail violated: shape $s is not Always Free"; fail=1 ;;
  esac
done

if [[ "$fail" -eq 0 ]]; then
  echo "Cost guardrails OK"
fi
exit "$fail"
