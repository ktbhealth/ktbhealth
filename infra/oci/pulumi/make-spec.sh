#!/usr/bin/env bash
# Generate ktb.spec.json for `pulumi up` on stack ktb-lgtm-iac.
#
# Pulls secrets from cuora (never printed), renders cloud-init.sh into
# the spec's userData field, and writes ktb.spec.json next to Pulumi.yaml.
#
# Prereqs:
#   - CUORA_IDENTITY_BACKEND=file
#   - run from anywhere; cuora.toml is discovered from the repo root
#   - pulumi stack ktb-lgtm-iac already initialized (network resources
#     exist; only the instance is created)
#
# Secrets consumed (all cuora://ktb/*, env=prod):
#   grafana-admin-password      -> .env GF_SECURITY_ADMIN_PASSWORD
#   ntfy-url                    -> .env NTFY_URL (self-hosted ktb-ntfy.*)
#   cloudflared-a1-tunnel-id    -> tunnel UUID in config + creds filename
#   cloudflared-a1-credentials  -> /etc/cloudflared/<uuid>.json
#
# The rendered spec embeds those secrets in user_data — visible in OCI
# instance metadata to tenancy members. Acceptable for a private
# tenancy; rotate via cuora + re-provision if that ever changes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
CUORA_TOML="${CUORA_TOML:-$REPO_ROOT/cuora.toml}"
ENV="${CUORA_ENV:-prod}"
export CUORA_IDENTITY_BACKEND=file

cuora_get() {
  cuora get --env "$ENV" --config "$CUORA_TOML" "cuora://ktb/$1" 2>/dev/null | tail -1
}

GF_ADMIN_PASSWORD="$(cuora_get grafana-admin-password)"
NTFY_URL="$(cuora_get ntfy-url)"
TUNNEL_ID="$(cuora_get cloudflared-a1-tunnel-id)"
TUNNEL_CREDS="$(cuora_get cloudflared-a1-credentials)"

for pair in "grafana-admin-password:$GF_ADMIN_PASSWORD" "ntfy-url:$NTFY_URL" \
  "cloudflared-a1-tunnel-id:$TUNNEL_ID" "cloudflared-a1-credentials:$TUNNEL_CREDS"; do
  [ -n "${pair#*:}" ] || { echo "missing cuora secret: ${pair%%:*}" >&2; exit 1; }
done

# Render cloud-init.sh -> user-data (secrets substituted, never echoed).
USER_DATA="$(sed \
  -e "s|__GF_ADMIN_PASSWORD__|${GF_ADMIN_PASSWORD}|g" \
  -e "s|__NTFY_URL__|${NTFY_URL}|g" \
  -e "s|__TUNNEL_ID__|${TUNNEL_ID}|g" \
  "$HERE/cloud-init.sh")"
# Credentials JSON may contain sed-special chars (& |) — append via a
# second pass that escapes & in the replacement.
USER_DATA="$(USER_DATA="$USER_DATA" TUNNEL_CREDS="$TUNNEL_CREDS" python3 - <<'PY'
import json, os, sys
ud = os.environ["USER_DATA"].replace("__TUNNEL_CREDENTIALS__", os.environ["TUNNEL_CREDS"])
sys.stdout.write(ud)
PY
)"

# Spec values mirror the running retry loop; only userData is new.
python3 - "$USER_DATA" > "$HERE/ktb.spec.json" <<'PY'
import json, sys
spec = {
    "name": "ktb-lgtm-pulumi",
    "region": "sa-saopaulo-1",
    "availabilityDomain": "VZXZ:SA-SAOPAULO-1-AD-1",
    "tenancyOcid": "ocid1.tenancy.oc1..aaaaaaaacdpnhw5quh7wt7qtxyet4qwgubfj4bpumhciv5p5wtfufludlafq",
    "compartmentOcid": "ocid1.tenancy.oc1..aaaaaaaacdpnhw5quh7wt7qtxyet4qwgubfj4bpumhciv5p5wtfufludlafq",
    "shape": "VM.Standard.A1.Flex",
    "ocpus": 1,
    "memoryInGbs": 6,
    "imageOcid": "ocid1.image.oc1.sa-saopaulo-1.aaaaaaaaw5a236wd55o7ecdrk5xmyuuiobzyidi2trqrgexeyt4rm3ytl7sa",
    "sshPublicKeys": ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGWyemwwyE300LHhylLVFHWkwGgoB3KUdKsSUN098AsE ktb-lgtm-oci"],
    "userData": sys.argv[1],
    "assignPublicIp": True,
    "vcnCidr": "10.0.0.0/16",
    "sshIngressCidr": "0.0.0.0/0",
}
print(json.dumps(spec, indent=2))
PY

echo "wrote $HERE/ktb.spec.json (userData: $(printf %s "$USER_DATA" | wc -c) bytes)"
