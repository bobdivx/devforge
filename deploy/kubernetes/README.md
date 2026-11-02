# DevForge sur Kubernetes (phase 1)

Tutoriel complet : wiki **[Kubernetes](../../wiki/Kubernetes.md)**.

| Élément | Chemin |
|---------|--------|
| Chart Helm de DevForge (+ `cloudflared` optionnel) | [`deploy/helm/devforge`](../helm/devforge) |
| Valeurs Traefik (IngressClass `traefik`) | [`traefik-values.yaml`](traefik-values.yaml) |
| Exemple CI : build → GHCR → déploiement | [`examples/github-actions-build-push.yml`](examples/github-actions-build-push.yml) |
| Backend Kubernetes (crate Rust) | [`crates/kube`](../../crates/kube) |
| Routes API | `apps/server/src/kube_routes.rs` (`/api/v1/kube/*`) |

## Choix par défaut (modifiables)

| Élément | Défaut | Changer |
|---------|--------|---------|
| Registre | GHCR + `apps.imagePullSecret` (Secret créé dans `devforge-apps`, recopié dans chaque namespace de projet) | `apps.imagePullSecret: ""` (images publiques) ou autre registre |
| Ingress | Traefik, `apps.ingressClass: traefik` | `apps.ingressClass: nginx` / `none` |
| Stockage | local-path (mono-nœud) | Longhorn en multi-nœud : `persistence.storageClass` / `postgresql.storageClass: longhorn` |
| Exposition | tunnel Cloudflare : `cloudflared.enabled: true` → `http://traefik.traefik.svc.cluster.local:80` | Traefik `LoadBalancer`/`NodePort` + cert-manager (`apps.clusterIssuer`) |
| Namespaces | un par projet : `apps.namespaceMode: perProject`, `devforge-<projet>` (ClusterRole) | `apps.namespaceMode: single` (Role limité à `apps.namespace`) |

Installation express (cluster avec StorageClass par défaut) :

```bash
helm repo add traefik https://traefik.github.io/charts && helm repo update
helm install traefik traefik/traefik -n traefik --create-namespace -f deploy/kubernetes/traefik-values.yaml
kubectl create ns devforge
kubectl -n devforge create secret generic cloudflared-token --from-literal=token='<JETON_TUNNEL>'
helm install devforge deploy/helm/devforge -n devforge \
  --set cloudflared.enabled=true --set cloudflared.existingSecret=cloudflared-token
```

Résumé :

- `DEVFORGE_RUNTIME=kubernetes` active le backend (le chart le pose). Sans cette variable,
  DevForge reste en mode **Docker** — comportement inchangé.
- Phase 1 : DevForge déploie une **image déjà construite** (Deployment + Service + Ingress +
  Secret d'env, probes, statut, logs, stop/start/restart, rolling update), dans le namespace
  du projet (`"project": "shop"` → `devforge-shop`). Pas de build dans le cluster.
- Build : en CI (exemple ci-dessus) ou en local, puis push sur un registre (GHCR…).
  [crane](https://github.com/google/go-containerregistry/tree/main/cmd/crane) sert à copier
  ou re-tagger une image sans Docker : `crane copy src dst`, `crane tag img:sha-abc prod`.
- Testé de bout en bout sur k3s 1.31 (Traefik 3.7, local-path) ; Talos réel pas encore validé.
- Phase 2 : build dans le cluster avec **Kaniko** (Job), intégration UI / projets.
