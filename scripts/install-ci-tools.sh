#!/usr/bin/env bash
# Installs pinned CI tools from their GitHub releases, verifying SHA-256 checksums.
# Binaries instead of third-party actions: fewer supply-chain surfaces in a public repo.
# Usage: scripts/install-ci-tools.sh <bin_dir> [tflint] [trivy] [gitleaks]
set -euo pipefail
# fetch runs inside $(...): without this, a failed checksum would not stop the script.
shopt -s inherit_errexit

bin_dir="$1"; shift
mkdir -p "$bin_dir"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() {
  local url="$1" sha="$2" out="$work/$(basename "$1")"
  curl -fsSL --retry 3 --retry-delay 2 -o "$out" "$url" || return 1
  echo "$sha  $out" | sha256sum -c --quiet - || { echo "checksum mismatch: $url" >&2; return 1; }
  echo "$out"
}

for tool in "$@"; do
  case "$tool" in
    tflint)
      f="$(fetch https://github.com/terraform-linters/tflint/releases/download/v0.65.0/tflint_linux_amd64.zip \
        d4c545ed2e29d6338604b586f34f544f380f70f243aa72f7b484713835eaec61)"
      unzip -q -o "$f" tflint -d "$bin_dir" ;;
    trivy)
      f="$(fetch https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz \
        c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0)"
      tar -xzf "$f" -C "$bin_dir" trivy ;;
    gitleaks)
      f="$(fetch https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
        551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb)"
      tar -xzf "$f" -C "$bin_dir" gitleaks ;;
    *) echo "unknown tool: $tool" >&2; exit 2 ;;
  esac
done
