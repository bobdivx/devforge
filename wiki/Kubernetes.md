# Kubernetes (Talos)

> **Statut : phase 1 (expérimental).** DevForge peut tourner **dans** un cluster Kubernetes
> et y déployer des apps **à partir d'une image déjà construite**. Docker reste le backend
> par défaut : sans `DEVFORGE_RUNTIME=kubernetes`, rien ne change.

## Choix par défaut

DevForge fait ces choix pour toi ; chacun se change par une valeur du chart.

| Élément | Défaut | Pour changer |
|---------|--------|--------------|
| Registre d'images | **GHCR** + `imagePullSecret` (recopié dans chaque namespace de projet) | `apps.imagePullSecret: ""` pour des images publiques ; tout registre `docker-registry` fonctionne (Docker Hub, Harbor…) |
| Ingress controller | **Traefik** (IngressClass `traefik`) | `apps.ingressClass: nginx` (ou `none` → classe par défaut du cluster) ; champ `ingress_class` par app |
| Stockage | **local-path** (mono-nœud) | multi-nœud : **Longhorn** (§ 2) puis `persistence.storageClass: longhorn`, `postgresql.storageClass: longhorn` |
| Exposition publique | **tunnel Cloudflare** : `cloudflared` → Service Traefik, TLS terminé chez Cloudflare | `cloudflared.enabled: false` + Traefik en `LoadBalancer`/`NodePort` et cert-manager (`apps.clusterIssuer`) |
| Namespaces | **un namespace par projet** : `devforge-<projet>`, créé à la demande (labels PodSecurity) | `apps.namespacePrefix: …` ; `apps.namespaceMode: single` → tout dans `apps.namespace` (RBAC limité à ce namespace) |
| PodSecurity des apps | `restricted` (images non-root) | `apps.podSecurity: baseline` + `"run_as_non_root": false` par app |

## Ce que fait la phase 1

| Fonction | Kubernetes |
|----------|------------|
| Déployer une image | `Deployment` (rolling update `maxSurge 1` / `maxUnavailable 0`) |
| Namespace | `devforge-<projet>` (champ `project`) ; sans projet → `devforge-apps` |
| Exposer l'app | `Service` ClusterIP (port 80 → port de l'app) |
| Domaine + HTTPS | `Ingress` Traefik (host ; TLS chez Cloudflare, ou cert-manager si `tls`) |
| Variables / secrets | `env` en clair + `Secret <app>-env` injecté (`envFrom`) |
| Healthcheck | `startupProbe` / `readinessProbe` / `livenessProbe` (HTTP si `health.path`, sinon TCP) |
| Statut | `absent` · `stopped` · `progressing` · `running` · `degraded` + raison par pod (`ImagePullBackOff`…) |
| Logs | API Pod (`pods/log`), 3 pods max, secrets masqués |
| Stop / start / restart | replicas → 0 / restauré · annotation `restartedAt` (redémarrage progressif) |
| Supprimer | Deployment, Service, Ingress, Secret (uniquement ceux étiquetés `managed-by: devforge`) ; le namespace du projet est conservé |

Sécurité des pods d'apps : `runAsNonRoot`, `seccomp RuntimeDefault`, `drop ALL`,
`allowPrivilegeEscalation: false`, pas de jeton de compte de service monté. Compatible
PodSecurity **restricted**.

En mode Kubernetes, DevForge **désactive** : Traefik Docker, le GC Docker, l'auto-update
Docker (mise à jour = `helm upgrade`) et le snapshot de bascule entre nœuds DevForge.

## 1. Prérequis Talos

- Un cluster Talos ≥ 1.7 (Kubernetes ≥ 1.30 : action `preStop.sleep`) et `talosctl`, `kubectl`, `helm` (v3) sur ton poste.
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

k3s (autre option mono-nœud) : fournit déjà local-path et Traefik — sauter les § 2 et 3.

## 2. Stockage : local-path (défaut mono-nœud)

Talos n'installe **aucune** StorageClass. DevForge a besoin de deux volumes `ReadWriteOnce`
(`/data` 10 Gi, Postgres 5 Gi).

```bash
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.32/deploy/local-path-storage.yaml
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

local-path attache un volume à **un** nœud : si ce nœud tombe, DevForge et sa base aussi.

**Multi-nœud : Longhorn** (volumes répliqués). Sur Talos, ajouter les extensions
`siderolabs/iscsi-tools` et `siderolabs/util-linux-tools` (Image Factory), puis :

```bash
kubectl create ns longhorn-system
kubectl label ns longhorn-system pod-security.kubernetes.io/enforce=privileged
helm repo add longhorn https://charts.longhorn.io && helm repo update
helm install longhorn longhorn/longhorn -n longhorn-system \
  --set defaultSettings.defaultDataPath=/var/lib/longhorn
kubectl get storageclass   # « longhorn »
```

Puis dans les valeurs DevForge : `persistence.storageClass: longhorn` et
`postgresql.storageClass: longhorn` (ou rendre `longhorn` classe par défaut).

## 3. Traefik (ingress controller par défaut)

Valeurs prêtes à l'emploi : [`deploy/kubernetes/traefik-values.yaml`](https://github.com/bobdivx/devforge/blob/main/deploy/kubernetes/traefik-values.yaml)
(IngressClass `traefik` par défaut du cluster, Service `ClusterIP` derrière le tunnel).

```bash
helm repo add traefik https://traefik.github.io/charts && helm repo update
helm install traefik traefik/traefik -n traefik --create-namespace \
  -f deploy/kubernetes/traefik-values.yaml
kubectl get ingressclass   # traefik
```

Sans tunnel Cloudflare : `service.spec.type: LoadBalancer` (MetalLB, IPAM Cilium) ou
`NodePort` (+ redirection du routeur), et cert-manager pour le TLS :

```bash
helm install cert-manager oci://quay.io/jetstack/charts/cert-manager -n cert-manager \
  --create-namespace --set crds.enabled=true
# puis un ClusterIssuer Let's Encrypt et --set apps.clusterIssuer=letsencrypt-prod
```

Autre contrôleur (ingress-nginx, Cilium) : `apps.ingressClass: nginx` et
`ingress.className: nginx`.

## 4. Exposition : tunnel Cloudflare (défaut)

Comme en prod Docker : aucun port ouvert, TLS public chez Cloudflare.

1. Cloudflare Zero Trust → **Networks → Tunnels** → créer un tunnel (type `cloudflared`) et
   copier son **jeton**.
2. Le mettre dans un Secret (clé `token`) :

   ```bash
   kubectl create namespace devforge
   kubectl -n devforge create secret generic cloudflared-token --from-literal=token='<JETON>'
   ```

3. Activer `cloudflared` dans le chart (§ 6) : `cloudflared.enabled: true`,
   `cloudflared.existingSecret: cloudflared-token`.
4. Dans le tunnel, **Public hostnames** : pour chaque domaine (`devforge.example.com`,
   `*.apps.example.com`…) → service `HTTP` `traefik.traefik.svc.cluster.local:80`.
   Traefik route ensuite selon l'en-tête `Host` des Ingress.

Le chart lance `cloudflared tunnel --no-autoupdate run` (non-root, racine en lecture seule,
sonde `/ready`). Pas besoin de cert-manager : laisse `tls` vide sur les apps.

## 5. Registre : GHCR + imagePullSecret (défaut)

Les apps doivent être **déjà construites** et poussées sur un registre. Avec GHCR privé :

1. Créer un PAT GitHub (classic) avec `read:packages` (lecture seule suffit au cluster).
2. Créer le Secret **une fois**, dans le namespace par défaut des apps (`devforge-apps`) :

   ```bash
   kubectl create namespace devforge-apps --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n devforge-apps create secret docker-registry ghcr-pull \
     --docker-server=ghcr.io --docker-username=<utilisateur_github> \
     --docker-password='<PAT read:packages>'
   ```

3. Le déclarer par défaut : `apps.imagePullSecret: ghcr-pull`. Au premier déploiement d'un
   projet, DevForge **recopie** ce Secret dans `devforge-<projet>` (sans jamais écraser un
   Secret du même nom déjà présent). Après rotation du PAT : supprimer les copies
   (`kubectl delete secret ghcr-pull -n devforge-<projet>`), elles sont recréées au
   déploiement suivant.

Images publiques : `apps.imagePullSecret: ""`.

**crane** (sans Docker) pour copier / re-tagger :

```bash
crane copy docker.io/library/nginx:1.27 ghcr.io/<org>/nginx:1.27
crane tag ghcr.io/<org>/mon-app:sha-1a2b3c4d prod
crane digest ghcr.io/<org>/mon-app:prod
```

## 6. Installer DevForge avec Helm

Le chart est dans le dépôt : `deploy/helm/devforge`.

```bash
git clone https://github.com/bobdivx/devforge && cd devforge

kubectl create namespace devforge --dry-run=client -o yaml | kubectl apply -f -
# DevForge lui-même respecte « restricted » :
kubectl label ns devforge pod-security.kubernetes.io/enforce=restricted --overwrite

cat > my-values.yaml <<'YAML'
image:
  repository: ghcr.io/bobdivx/devforge
  tag: ""                    # vide = appVersion du chart
ingress:                     # UI DevForge via Traefik (hôte publié dans le tunnel)
  enabled: true
  className: traefik
  host: devforge.example.com
persistence:
  size: 10Gi
  storageClass: ""           # vide = classe par défaut (local-path) ; longhorn en multi-nœud
postgresql:
  enabled: true              # Postgres intégré ; false + external.existingSecret pour une base externe
apps:
  namespaceMode: perProject  # ou single
  namespacePrefix: devforge-
  namespace: devforge-apps
  podSecurity: restricted    # « baseline » si tes images tournent en root
  ingressClass: traefik
  imagePullSecret: ghcr-pull # "" si images publiques
cloudflared:
  enabled: true
  existingSecret: cloudflared-token
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
| `ServiceAccount` + RBAC | `perProject` : `ClusterRole` (namespaces get/list/create/patch ; deployments, services, secrets, ingresses ; lecture pods / logs / events). `single` : `Role` limité à `apps.namespace` |
| `Namespace devforge-apps` | labels PodSecurity, conservé au `uninstall` |
| `Deployment cloudflared` (+ Secret si `cloudflared.token`) | tunnel Cloudflare, si `cloudflared.enabled` |
| `Service` + `Ingress` | accès à l'interface |

Base externe : créer un Secret avec la clé `database-url` (`postgres://user:pass@host:5432/db`)
puis `--set postgresql.enabled=false --set postgresql.external.existingSecret=<secret>`.

Mise à jour : `helm upgrade devforge deploy/helm/devforge -n devforge -f my-values.yaml --set image.tag=<version>`.

### Namespaces par projet et RBAC

Les namespaces sont créés à la demande : le compte de service a donc des droits au niveau
du cluster. Garde-fous dans DevForge :

- il n'agit que dans `<préfixe><projet>` (slug DNS validé) ou `apps.namespace` ;
- il refuse un namespace existant qui n'a pas le label `app.kubernetes.io/managed-by=devforge` ;
- il ne modifie / supprime que des objets portant ce label (jamais un Deployment posé à la main).

Pour un RBAC strictement namespacé, `apps.namespaceMode: single`. Supprimer la dernière app
d'un projet ne supprime pas son namespace : `kubectl delete ns devforge-<projet>`.

## 7. Première app

Avec le jeton API d'un admin d'instance :

```bash
export DF=https://devforge.example.com DF_TOKEN=df_xxx

# État du backend (mode de namespace, IngressClass, version de l'API Kubernetes)
curl -s -H "Authorization: Bearer $DF_TOKEN" $DF/api/v1/kube/info

# Déployer dans le projet « shop » → namespace devforge-shop (attend le rollout, 5 min max)
curl -s -X POST "$DF/api/v1/kube/apps?wait=true&timeout=300" \
  -H "Authorization: Bearer $DF_TOKEN" -H "Content-Type: application/json" -d '{
    "project": "shop",
    "name": "hello",
    "image": "nginxinc/nginx-unprivileged:1.27",
    "port": 8080,
    "replicas": 2,
    "host": "hello.example.com",
    "env": { "MODE": "prod" },
    "secrets": { "API_KEY": "change-me" },
    "health": { "path": "/" },
    "resources": { "memory": "256m", "cpus": "0.5" }
  }'

Q="?project=shop"
curl -s -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps$Q"            # apps du projet
curl -s -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello$Q"      # statut
curl -s -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello/logs$Q&tail=200"
curl -s -X POST -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello/restart$Q"
curl -s -X POST -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello/stop$Q"
curl -s -X POST -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello/start$Q"
curl -s -X DELETE -H "Authorization: Bearer $DF_TOKEN" "$DF/api/v1/kube/apps/hello$Q"
```

`GET /kube/apps` sans `project` liste toutes les apps DevForge (tous projets).
Le domaine `hello.example.com` doit être publié dans le tunnel Cloudflare (§ 4).

Prévisualiser les manifests sans rien appliquer (fonctionne aussi en mode Docker) :
`POST /api/v1/kube/render` avec le même corps (secrets affichés `***`).

Champs : `project` (slug DNS, optionnel), `name` (DNS, ≤ 40 car.), `image`, `port` (8080),
`replicas` (1, 0–20), `host`, `tls` (`secret_name`, `cluster_issuer` — inutile derrière
Cloudflare), `env`, `secrets`, `health` (`path`, `initial_delay_seconds`, `period_seconds`,
`failure_threshold`), `resources` (`memory` `512m`/`1g`, `cpus` `0.5`), `image_pull_secret`,
`ingress_class`, `run_as_non_root` (true), `run_as_user`.

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
  l'interface (pages Deployments, Domains, Env du projet = mode Docker) ; le champ `project`
  est un slug libre qui choisit le namespace.
- Les fonctions Docker (atelier preview, Traefik géré, runners Docker, GC, auto-update,
  backups de volumes Docker) ne s'appliquent pas aux apps Kubernetes.
- Pas de volumes persistants pour les apps ; pas d'HPA ; namespaces de projet non supprimés
  automatiquement.
- `restricted` impose des images **non-root** (ex. `nginxinc/nginx-unprivileged` plutôt
  que `nginx`) ; sinon `apps.podSecurity: baseline` et `"run_as_non_root": false`.
- DevForge lui-même : 1 réplica (PVC `ReadWriteOnce`).
- Testé de bout en bout sur **k3s 1.31** mono-nœud (Traefik 3.7 via Helm, local-path,
  chart DevForge, app déployée par l'API, trafic HTTP via Traefik, logs, restart, rolling
  update, suppression). **Pas encore validé sur un cluster Talos réel**, ni avec Longhorn,
  ni avec un vrai tunnel Cloudflare (le Deployment `cloudflared` est rendu et validé par
  l'API, sans jeton réel).

## Feuille de route

**Phase 2**
- Build dans le cluster avec **Kaniko** (Job éphémère : clone Git → build → push registre),
  déclenché par l'auto-deploy GitHub.
- Intégration projets / UI : un projet choisit son backend (Docker ou Kubernetes) ; pages
  Deployments, Env, Domains et logs branchées sur le backend Kubernetes.
- Adaptateur Docker du trait `ImageRuntime` (même API pour les deux backends).
- Volumes persistants d'apps (PVC), CronJobs.

**Phase 3**
- Multi-clusters, HPA, NetworkPolicies par projet.
- Promotion d'images entre environnements (crane), canary.
- Opérateur / CRD `DevForgeApp`, haute disponibilité du control plane.

## Dépannage

| Symptôme | Piste |
|----------|-------|
| `409` sur `/kube/*` | `DEVFORGE_RUNTIME` n'est pas `kubernetes` (mode Docker) |
| `403` Kubernetes | RBAC : mode `single` mais app avec `project` hors de `apps.namespace`, ou chart installé sans le ClusterRole (`perProject`) |
| « namespace … n'est pas géré par DevForge » | un namespace `devforge-<projet>` existe déjà sans le label `app.kubernetes.io/managed-by=devforge` : le renommer, ou ajouter le label si c'est voulu |
| `ImagePullBackOff` | `imagePullSecret` absent de `devforge-apps` (source de la copie), PAT expiré (supprimer les copies, § 5), ou nom d'image en majuscules (GHCR) |
| `404` sur une app | oubli de `?project=<projet>` (l'app est dans `devforge-<projet>`) |
| Pod refusé « violates PodSecurity » | image root → `apps.podSecurity: baseline` + `run_as_non_root: false` |
| PVC `Pending` | pas de StorageClass par défaut (§ 2) |
| Ingress sans adresse | pas d'ingress controller ou pas de LoadBalancer (§ 3) |
| `502` / `1033` Cloudflare | tunnel arrêté (`kubectl -n devforge logs deploy/devforge-cloudflared`) ou hostname public ne pointant pas vers `traefik.traefik.svc.cluster.local:80` |

Voir aussi : [[Installation]] · [[Architecture]] · [[FAQ]]
