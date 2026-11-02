# DevForge sur Kubernetes (phase 1)

Tutoriel complet : wiki **[Kubernetes](../../wiki/Kubernetes.md)**.

| Élément | Chemin |
|---------|--------|
| Chart Helm de DevForge | [`deploy/helm/devforge`](../helm/devforge) |
| Exemple CI : build → GHCR → déploiement | [`examples/github-actions-build-push.yml`](examples/github-actions-build-push.yml) |
| Backend Kubernetes (crate Rust) | [`crates/kube`](../../crates/kube) |
| Routes API | `apps/server/src/kube_routes.rs` (`/api/v1/kube/*`) |

Résumé :

- `DEVFORGE_RUNTIME=kubernetes` active le backend (le chart le pose). Sans cette variable,
  DevForge reste en mode **Docker** — comportement inchangé.
- Phase 1 : DevForge déploie une **image déjà construite** (Deployment + Service + Ingress +
  Secret d'env, probes, statut, logs, stop/start/restart, rolling update). Pas de build
  dans le cluster.
- Build : en CI (exemple ci-dessus) ou en local, puis push sur un registre (GHCR…).
  [crane](https://github.com/google/go-containerregistry/tree/main/cmd/crane) sert à copier
  ou re-tagger une image sans Docker : `crane copy src dst`, `crane tag img:sha-abc prod`.
- Phase 2 : build dans le cluster avec **Kaniko** (Job), intégration UI / projets.
