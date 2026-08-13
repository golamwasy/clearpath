#!/usr/bin/env bash
# One-command bring-up: creates a local kind cluster, builds and loads the 8 app images that this
# repo builds from source, applies the deploy/k8s/base kustomization, and waits for every
# Deployment to become ready.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CLUSTER_NAME="clearpath"

cd "${REPO_ROOT}"

echo "==> Ensuring kind cluster '${CLUSTER_NAME}' exists"
if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
  echo "    cluster '${CLUSTER_NAME}' already exists, skipping create"
else
  kind create cluster --name "${CLUSTER_NAME}" --config "${SCRIPT_DIR}/kind-config.yaml"
fi

# service:dockerfile pairs, mirroring docker-compose.yml's build.context (always ".") /
# build.dockerfile exactly.
IMAGES=(
  "menu-service:menu-service/Dockerfile"
  "availability-service:availability-service/Dockerfile"
  "trace-collector:trace-collector/Dockerfile"
  "storefront-api:storefront-api/Dockerfile"
  "pos-ingest:pos-ingest/Dockerfile"
  "merchant-web:merchant-web/Dockerfile"
  "nested-pos:mocks/nested-pos/Dockerfile"
  "flat-pos:mocks/flat-pos/Dockerfile"
)

echo "==> Building app images"
for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  dockerfile="${entry#*:}"
  echo "    building ${name}:local (-f ${dockerfile})"
  docker build -t "${name}:local" -f "${dockerfile}" .
done

echo "==> Loading images into kind cluster '${CLUSTER_NAME}'"
for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  echo "    loading ${name}:local"
  kind load docker-image "${name}:local" --name "${CLUSTER_NAME}"
done

echo "==> Applying deploy/k8s/base"
# `kubectl apply -k` has no --load-restrictor flag (that's only exposed on `kubectl kustomize`),
# so we render with `kubectl kustomize` and pipe into `kubectl apply -f -` instead.
#
# --load-restrictor LoadRestrictionsNone: the configMapGenerator entries for postgres-init.sh and
# venues.json point outside deploy/k8s/base (at docker/postgres-init.sh and pos-ingest/venues.json
# respectively) so those ConfigMaps are generated straight from the real source files instead of
# a hand-copied duplicate that could drift. kustomize's default LoadRestrictionsRootOnly forbids
# that; this is a purely local kustomization (no remote bases), so relaxing it here is safe.
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/base | kubectl apply -f -

DEPLOYMENTS=(
  postgres
  redis
  mongo
  kafka
  menu-service
  availability-service
  trace-collector
  storefront-api
  pos-ingest
  nested-pos
  flat-pos
  merchant-web
  prometheus
  grafana
)

echo "==> Waiting for deployments to become ready"
for d in "${DEPLOYMENTS[@]}"; do
  echo "    rollout status: ${d}"
  kubectl -n clearpath rollout status "deployment/${d}" --timeout=180s
done

cat <<EOF

==> clearpath is up on kind cluster '${CLUSTER_NAME}'

Merchant web UI:
  kubectl port-forward -n clearpath svc/merchant-web 5173:8080
  open http://localhost:5173

Grafana:
  kubectl port-forward -n clearpath svc/grafana 3000:3000
  open http://localhost:3000

Prometheus:
  kubectl port-forward -n clearpath svc/prometheus 9090:9090
  open http://localhost:9090

To tear everything down: deploy/k8s/kind-down.sh
EOF
