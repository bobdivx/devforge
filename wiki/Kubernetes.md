# Kubernetes (Talos)

> **Statut : phase 1 (expérimental).** DevForge peut tourner **dans** un cluster Kubernetes
> et y déployer des apps **à partir d'une image déjà construite**. Docker reste le backend
> par défaut : sans `DEVFORGE_RUNTIME=kubernetes`, rien ne change.

## Ce que fait la phase 1

| Fonction | Kubernetes |
|----------|------------|
| Déployer une image | `Deployment` (rolling update `maxSurge 1` / `maxUnavailable 0`) |
| Exposer l'app | `Service` ClusterIP (port 80 → port de l'app) |
| Domaine + HTTPS | `Ingress` (host, `ingressClassName`, TLS optionnel via cert-manager) |
| Variables / secrets | `env` en clair + `Secret <app>-env` injecté (`envFrom`) |
| Healthcheck | `startupProbe` / `readinessProbe` / `livenessProbe` (HTTP si `health.path`, sinon TCP) |
| Statut | `absent` · `stopped` · `progressing` · `running` · `degraded` + raison par pod (`ImagePullBackOff`…) |
| Logs | API Pod (`pods/log`), 3 pods max, secrets masqués |
| Stop / start / restart | replicas → 0 / restauré · annotation `restartedAt` (redémarrage progressif) |
| Supprimer | Deployment, Service, Ingress, Secret (uniquement ceux étiquetés `managed-by: devforge`) |

Sécurité des pods d'apps : `runAsNonRoot`, `seccomp RuntimeDefault`, `drop ALL`,
`allowPrivilegeEscalation: false`, pas de jeton de compte de service monté. Compatible
PodSecurity **restricted**.

En mode Kubernetes, DevForge **désactive** : Traefik Docker, le GC Docker et l'auto-update
Docker (mise à jour = `helm upgrade`).

## 1. Prérequis Talos

- Un cluster Talos ≥ 1.7 (Kubernetes ≥ 1.29) et `talosctl`, `kubectl`, `helm` (v3) sur ton poste.
- Récupérer le kubeconfig :

  ```bash
  talosctl -n <IP_CONTROL_PLANE> kubeconfig ~/.kube/config
  kubectl get nodes
  ```

- Talos active l'admission **PodSecurity** (par défaut `enforce: baseline`, `warn/audit: restricted`).
  Le chart DevForge et les apps qu'il déploie respectent `restricted`. Les add-ons qui ont
  besoin de `hostPath` (local-path, Longhorn…) doivent avoir leur namespace en `privileged`.
- Cluster mono-nœud (control plane seul) : autoriser les workloads sur le control plane
  dans la machine config :

  ```yaml
  cluster:
    allowSchedulingOnControlPlanes: true
  ```

## 2. Stockage (StorageClass)

Talos n'installe **aucune** StorageClass. DevForge a besoin de deux volumes `ReadWriteOnce`
(`/data` 10 Gi, Postgres 5 Gi).

**Option simple (mono-nœud / homelab) — local-path-provisioner :**

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.30/deploy/local-path-storage.yaml
kubectl label ns local-path-storage pod-security.kubernetes.io/enforce=privileged --overwrite
kubectl patch storageclass local-path -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

Talos : `/opt` est en lecture seule → pointer local-path vers `/var/local-path-provisioner`
(ConfigMap `local-path-config`) et monter ce chemin dans la machine config :

```yaml
machine:
  kubelet:
    extraMounts:
      - destination: /var/local-path-provisioner
        type: bind
        source: /var/local-path-provisioner
        options: [bind, rshared, rw]
```

**Option multi-nœuds** : Longhorn (extensions Talos `iscsi-tools` + `util-linux-tools`) ou
Rook-Ceph. Vérifier : `kubectl get storageclass` (une classe `(default)`).

## 3. Ingress controller

Talos n'en fournit pas. Exemple avec ingress-nginx :

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer   # ou NodePort sans LB
```

- **LoadBalancer** sur bare metal : MetalLB ou l'IPAM Cilium ; sinon `NodePort` + redirection
  du routeur.
- **TLS** : cert-manager + un `ClusterIssuer` (Let's Encrypt) :

  ```bash
  helm install cert-manager oci://quay.io/jetstack/charts/cert-manager -n cert-manager \
    --create-namespace --set crds.enabled=true
  ```

- **Sans IP publique** : Cloudflare Tunnel (`cloudflared` en Deployment) qui pointe vers
  `http://ingress-nginx-controller.ingress-nginx.svc`. Dans ce cas TLS est terminé chez
  Cloudflare : pas besoin de cert-manager.

Traefik (le contrôleur utilisé par DevForge en mode Docker) fonctionne aussi :
`ingressClass: traefik`.

## 4. Registre d'images (GHCR) et imagePullSecret

Les apps doivent être **déjà construites** et poussées sur un registre. Avec GHCR :

1. Créer un PAT GitHub (classic) avec `read:packages` (lecture seule suffit au cluster).
2. Créer le Secret dans le namespace des apps (`devforge-apps` par défaut) — à faire
   **après** l'install Helm (qui crée le namespace) ou en créant le namespace avant :

   ```bash
   kubectl create namespace devforge-apps --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n devforge-apps create secret docker-registry ghcr-pull \
     --docker-server=ghcr.io --docker-username=<utilisateur_github> \
     --docker-password='<PAT read:packages>'
   ```

3. Le déclarer par défaut dans le chart : `--set apps.imagePullSecret=ghcr-pull`.

Images publiques : rien à faire.

**crane** (sans Docker) pour copier / re-tagger :

```bash
crane copy docker.io/library/nginx:1.27 ghcr.io/<org>/nginx:1.27
crane tag ghcr.io/<org>/mon-app:sha-1a2b3c4d prod
crane digest ghcr.io/<org>/mon-app:prod
```

## 5. Installer DevForge avec Helm

Le chart est dans le dépôt : `deploy/helm/devforge`.

```bash
git clone https://github.com/bobdivx/devforge && cd devforge

kubectl create namespace devforge
# DevForge lui-même respecte « restricted » :
kubectl label ns devforge pod-security.kubernetes.io/enforce=restricted

cat > my-values.yaml <<'YAML'
image:
  repository: ghcr.io/bobdivx/devforge
  tag: ""                  # vide = appVersion du chart
ingress:
  enabled: true
  className: nginx         # ou traefik, cilium…
  host: devforge.example.com
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    enabled: true
persistence:
  size: 10Gi
  storageClass: ""         # vide = classe par défaut
postgresql:
  enabled: true            # Postgres intégré ; false + external.existingSecret pour une base externe
apps:
  namespace: devforge-apps
  podSecurity: restricted  # « baseline » si tes images tournent en root
  ingressClass: nginx
  clusterIssuer: letsencrypt-prod
  imagePullSecret: ghcr-pull
YAML

helm lint deploy/helm/devforge -f my-values.yaml
helm install devforge deploy/helm/devforge -n devforge -f my-values.yaml
kubectl -n devforge rollout status deploy/devforge
kubectl -n devforge get pods,pvc,ingress
```

Sans Ingress : `kubectl -n devforge port-forward svc/devforge 8000:80` puis
http://127.0.0.1:8000.

Ouvrir l'interface → [[Premier démarrage|Premier-demarrage]] (création du compte admin), puis
**Compte → Tokens** pour créer un jeton API.

Ce que crée le chart :

| Ressource | Rôle |
|-----------|------|
| `Deployment devforge` (1 réplica, `Recreate`) | serveur, uid 1000 non-root, probes sur `/api/v1/health` |
| `PVC devforge-data` | `/data` (conservé au `helm uninstall`) |
| `StatefulSet devforge-postgres` + Secret | base du control plane (mot de passe aléatoire conservé aux upgrades) |
| `ServiceAccount` + `Role/RoleBinding` | droits **limités au namespace des apps** : deployments, services, secrets, ingresses, lecture pods / logs / events |
| `Namespace devforge-apps` | labels PodSecurity, conservé au `uninstall` |
| `Service` + `Ingress` | accès à l'interface |

Base externe : créer un Secret avec la clé `database-url` (`postgres://user:pass@host:5432/db`)
puis `--set postgresql.enabled=false --set postgresql.external.existingSecret=<secret>`.

Mise à jour : `helm upgrade devforge deploy/helm/devforge -n devforge -f my-values.yaml --set image.tag=<version>`.

## 6. Première app

Avec le jeton API d'un admin d'instance :

```bash
export DF=https://devforge.example.com DF_TOKEN=df_xxx

# État du backend (namespace, version de l'API Kubernetes)
curl -s -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/info

# Déployer (attend la fin du rollout, 5 min max)
curl -s -X POST "$DF/api/v1/kube/apps?wait=true&timeout=300" \
  -H "Authorization: Bearer $DF_TOKEN" -H "Content-Type: application/json" -d '{
    "name": "hello",
    "image": "nginxinc/nginx-unprivileged:1.27",
    "port": 8080,
    "replicas": 2,
    "host": "hello.example.com",
    "tls": {},
    "env": { "MODE": "prod" },
    "secrets": { "API_KEY": "change-me" },
    "health": { "path": "/" },
    "resources": { "memory": "256m", "cpus": "0.5" }
  }'

curl -s -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/apps/hello          # statut
curl -s -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello/logs?tail=200"
curl -s -X POST -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/apps/hello/restart
curl -s -X POST -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/apps/hello/stop
curl -s -X POST -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/apps/hello/start
curl -s -X DELETE -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/apps/hello
```

Prévisualiser les manifests sans rien appliquer (fonctionne aussi en mode Docker) :
`POST /api/v1/kube/render` avec le même corps (secrets affichés `***`).

Champs : `name` (DNS, ≤ 40 car.), `image`, `port` (8080), `replicas` (1, 0–20), `host`,
`tls` (`secret_name`, `cluster_issuer`), `env`, `secrets`, `health` (`path`,
`initial_delay_seconds`, `period_seconds`, `failure_threshold`), `resources` (`memory`
`512m`/`1g`, `cpus` `0.5`), `image_pull_secret`, `ingress_class`, `run_as_non_root` (true),
`run_as_user`.

Redéployer = refaire le `POST` avec une nouvelle image : rolling update sans coupure
(readiness). Un changement d'`env`/`secrets` redémarre aussi les pods (hash de config).

### Depuis GitHub Actions

Exemple complet (build → push GHCR → `POST /kube/apps?wait=true`) :
[`deploy/kubernetes/examples/github-actions-build-push.yml`](https://github.com/bobdivx/devforge/blob/main/deploy/kubernetes/examples/github-actions-build-push.yml).
À copier dans le dépôt de l'app (`.github/workflows/deploy.yml`) avec les secrets
`DEVFORGE_URL` et `DEVFORGE_TOKEN`. L'image est taggée `sha-<commit>` (immuable).

## Limites de la phase 1

- **Pas de build dans le cluster** : l'image doit exister sur un registre.
- **API seulement** : les apps Kubernetes ne sont pas encore reliées aux projets DevForge ni à
  l'interface (pages Deployments, Domains, Env du projet = mode Docker).
- Les fonctions Docker (atelier preview, Traefik géré, runners Docker, GC, auto-update,
  backups de volumes Docker) ne s'appliquent pas aux apps Kubernetes.
- Un seul namespace d'apps ; pas de volumes persistants pour les apps ; pas d'HPA.
- `restricted` impose des images **non-root** (ex. `nginxinc/nginx-unprivileged` plutôt
  que `nginx`) ; sinon `apps.podSecurity: baseline` et `"run_as_non_root": false`.
- DevForge lui-même : 1 réplica (PVC `ReadWriteOnce`).
- Testé contre un vrai kube-apiserver 1.31 (apply, prune, RBAC, PodSecurity) ; **pas encore
  validé sur un cluster Talos réel** (exécution des pods, Ingress, TLS).

## Feuille de route

**Phase 2**
- Build dans le cluster avec **Kaniko** (Job éphémère : clone Git → build → push registre),
  déclenché par l'auto-deploy GitHub.
- Intégration projets / UI : un projet choisit son backend (Docker ou Kubernetes) ; pages
  Deployments, Env, Domains et logs branchées sur le backend Kubernetes.
- Adaptateur Docker du trait `ImageRuntime` (même API pour les deux backends).
- Volumes persistants d'apps (PVC), CronJobs.

**Phase 3**
- Multi-namespaces / multi-clusters, HPA, NetworkPolicies par app.
- Promotion d'images entre environnements (crane), canary.
- Opérateur / CRD `DevForgeApp`, haute disponibilité du control plane.

## Dépannage

| Symptôme | Piste |
|----------|-------|
| `409` sur `/kube/*` | `DEVFORGE_RUNTIME` n'est pas `kubernetes` (mode Docker) |
| `403` Kubernetes | RBAC : namespace des apps ≠ `apps.namespace` du chart |
| `ImagePullBackOff` | `imagePullSecret` absent du namespace des apps, ou nom d'image en majuscules (GHCR) |
| Pod refusé « violates PodSecurity » | image root → `apps.podSecurity: baseline` + `run_as_non_root: false` |
| PVC `Pending` | pas de StorageClass par défaut (§ 2) |
| Ingress sans adresse | pas d'ingress controller ou pas de LoadBalancer (§ 3) |

Voir aussi : [[Installation]] · [[Architecture]] · [[FAQ]]
