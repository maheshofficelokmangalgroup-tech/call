#!/usr/bin/env bash
# The only thing the CI's SSH key may do. In ~/.ssh/authorized_keys the key is written as
#   command="/home/ubuntu/calling/deploy/shared/ci-entry.sh",restrict ssh-ed25519 AAAA... calling-ci
# so whatever the CI asks for, this script runs instead. It accepts exactly
#   deploy <image tag> <40-character commit id>      (the GitHub token for the image download comes on standard input)
#   renew-cert
# and nothing else: no shell, no file copy, no port forwarding.
set -euo pipefail

command_line="${SSH_ORIGINAL_COMMAND:-}"
here="$(dirname "${BASH_SOURCE[0]}")"

if [[ "$command_line" =~ ^deploy\ ([A-Za-z0-9._-]{1,64})\ ([0-9a-f]{40})$ ]]; then
  exec "$here/deploy.sh" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
elif [ "$command_line" = "renew-cert" ]; then
  exec "$here/renew-cert.sh"
fi
echo "refused: this key can only run 'deploy <tag> <commit>' or 'renew-cert'" >&2
exit 2
