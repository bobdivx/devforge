# Auto-Deploy Investigation — DevForge v2.0.53

## Résumé

DevForge **implémente déjà** l'auto-deploy via webhook GitHub, mais il manque :

1. **Documentation utilisateur** sur comment l'activer
2. **UI de configuration** pour faciliter le setup
3. **Indicateurs visuels** dans la GUI pour montrer si auto-deploy est actif

## Comment fonctionne l'auto-deploy actuellement

### Webhook GitHub (`/api/v1/webhooks/github`)

**Fichier** : `apps/server/src/infra_routes.rs` (lignes 1402-1590)

Le serveur expose un endpoint webhook qui :

1. **Reçoit les événements `push` de GitHub**
2. **Vérifie la signature HMAC** (si `DEVFORGE_GITHUB_WEBHOOK_SECRET` est défini)
3. **Trouve les projets** qui matchent le repo (via `git_repository`)
4. **Filtre par branche** : compare `git_branch` du projet avec la branche du push
5. **Lance un déploiement automatique** pour chaque projet qui correspond

### Configuration requise

#### Variables d'environnement

```bash
# Secret pour sécuriser le webhook (HMAC-SHA256)
DEVFORGE_GITHUB_WEBHOOK_SECRET=ton-secret-aleatoire-ici

# Alternative pour dev/lab uniquement
DEVFORGE_ALLOW_INSECURE_WEBHOOK=1  # Accepte webhooks sans signature
```

**Fichiers de config** :
- `docker-compose.yml` ligne 39
- `deploy/docker-compose.yml` ligne 40-42
- `.env.example` lignes 20, 46-47, 51

#### Configuration GitHub

Pour chaque repo qui doit auto-deploy :

1. **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL** : `https://ton-domaine.com/api/v1/webhooks/github`
3. **Content type** : `application/json`
4. **Secret** : même valeur que `DEVFORGE_GITHUB_WEBHOOK_SECRET`
5. **Events** : sélectionner **"Just the push event"**

### Flow de déploiement

```
GitHub push → Webhook → DevForge
                ↓
        Compare repo + branch
                ↓
        CREATE deployment record
                ↓
        EXECUTE deploy pipeline
                ↓
        UPDATE deployment status
```

## Ce qui manque pour l'expérience utilisateur

### 1. UI pour configuration webhook (priorité haute)

**Problème** : Utilisateurs ne savent pas qu'ils doivent configurer le webhook GitHub manuellement.

**Solution** : Ajouter dans `ProjectDetailPage` ou `ProjectGitPanel` :

```tsx
// Section "Auto-Deploy"
<Card>
  <CardHeader title="Auto-Deploy sur push" />
  
  {!webhookConfigured && (
    <Alert tone="warn">
      Webhook GitHub non configuré — les pushs ne déclenchent pas de déploiement automatique.
    </Alert>
  )}
  
  <div class="space-y-2">
    <p class="text-sm">Webhook URL :</p>
    <Input
      readonly
      value={`${apiBase}/api/v1/webhooks/github`}
      onClick={(e) => e.target.select()}
    />
    
    {webhookSecretDefined ? (
      <Badge tone="ok">Secret défini sur le serveur</Badge>
    ) : (
      <Badge tone="warn">Secret non défini (mode dev uniquement)</Badge>
    )}
    
    <Button
      href={`${project.git_repository}/settings/hooks/new`}
      target="_blank"
      variant="outline"
    >
      Configurer sur GitHub
    </Button>
  </div>
  
  <details class="mt-3">
    <summary class="cursor-pointer text-sm">Instructions</summary>
    <ol class="mt-2 space-y-1 text-xs">
      <li>1. Colle l'URL webhook ci-dessus</li>
      <li>2. Content type : application/json</li>
      <li>3. Secret : demande-le à l'admin instance</li>
      <li>4. Events : Just the push event</li>
      <li>5. Active : ✓</li>
    </ol>
  </details>
</Card>
```

### 2. Endpoint API pour vérifier webhook (priorité moyenne)

**Nouveau endpoint** : `GET /api/v1/projects/{uuid}/webhook-status`

Retourne :
```json
{
  "webhook_url": "https://devforge.example.com/api/v1/webhooks/github",
  "secret_configured": true,
  "allow_insecure": false,
  "repo_url": "https://github.com/owner/repo",
  "branch": "main",
  "last_webhook_trigger": "2026-09-15T03:30:00Z",
  "suggestion": "Configure webhook at https://github.com/owner/repo/settings/hooks"
}
```

### 3. Dashboard indicateur (priorité basse)

Dans `ProjectsListPage`, ajouter un badge par projet :

```tsx
{project.webhook_active ? (
  <Badge tone="ok">Auto-deploy ✓</Badge>
) : (
  <Badge tone="muted">Manuel</Badge>
)}
```

## Ce qui fonctionne déjà

✅ **Webhook endpoint** implémenté et sécurisé (HMAC-SHA256)  
✅ **Matching repo + branche** automatique  
✅ **Logs de déploiement** enregistrés dans `deployments` table  
✅ **Support multi-projets** : un push peut trigger plusieurs projets  
✅ **GitHub token** injecté pour repos privés  
✅ **Variables d'environnement** (`project_env_vars`) exportées  
✅ **Labels Traefik** appliqués automatiquement  

## État pour popcorn-client

**Projet** : `bobdivx/popcorn-client` (branche `dev`)

**Diagnostic** :
1. ✅ Projet a `git_repository` et `git_branch` configurés
2. ✅ Le code webhook existe et fonctionne
3. ❌ **Webhook GitHub probablement non configuré sur le repo**
4. ❌ **Pas d'UI pour guider l'utilisateur**

**Test rapide** :

```bash
# Vérifier si DEVFORGE_GITHUB_WEBHOOK_SECRET est défini
docker exec devforge-server printenv | grep WEBHOOK

# Tester le webhook manuellement
curl -X POST https://ton-domaine.com/api/v1/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d '{
    "ref": "refs/heads/dev",
    "repository": {
      "full_name": "bobdivx/popcorn-client",
      "html_url": "https://github.com/bobdivx/popcorn-client"
    },
    "head_commit": {
      "id": "abc123",
      "message": "test webhook"
    }
  }'
```

## Problème Traefik séparé

**Observation** : "Traefik keeps disappearing after deploys"

**Cause potentielle** : Fixé dans PR #48 (`cursor/fix-traefik-self-update-disappear-c0f7`)

**Code critique** : `crates/deploy/src/docker.rs` lignes 440-450

```rust
// CRITICAL FIX (2026-09-14 incident C): Ensure df-* containers are connected to devforge network
if echo "$N" | grep -q "^df-"; then
  if ! echo "$NET" | grep -q "devforge"; then
    if docker network inspect devforge >/dev/null 2>&1; then
      docker network connect devforge "$CID" 2>/dev/null || true
      echo "recreated $N with traefik labels + connected to devforge network"
    }
  }
}
```

**Vérification** :
```bash
# Le container Traefik doit être sur le même réseau que les apps
docker network inspect devforge | jq '.[0].Containers | keys'

# Si DEVFORGE_DOCKER_NETWORK n'est pas défini
printenv DEVFORGE_DOCKER_NETWORK
```

**Fix** : S'assurer que `DEVFORGE_DOCKER_NETWORK=devforge` est défini dans l'environnement du serveur.

## Recommandations

### Court terme (PR immédiate)

1. **Ajouter section Auto-Deploy** dans `ProjectGitPanel.tsx`
2. **Documenter le webhook** dans README ou docs/
3. **Afficher le secret status** (défini/non défini) dans UI

### Moyen terme

1. **Endpoint webhook-status** pour diagnostics
2. **Test webhook** depuis l'UI (bouton "Test auto-deploy")
3. **Logs webhooks** dans une table dédiée pour debug

### Long terme

1. **GitHub App** (comme legacy alpha) pour auto-configurer webhooks
2. **Polling alternatif** : cron qui check `git ls-remote` toutes les 5min
3. **Webhooks autres providers** (GitLab, Gitea, etc.)

## Polling + webhook ensure (corrigé)

Depuis le fix auto-deploy :

1. **Poller** (`apps/server/src/auto_deploy.rs`) : toutes les ~90s (`DEVFORGE_AUTO_DEPLOY_POLL_SECS`), compare SHA déployé vs branche GitHub pour les projets `auto_deploy=1`, et déclenche un deploy s'il y a du retard.
2. **Webhook ensure** : au démarrage / périodiquement / à l'activation du toggle, tente `POST /repos/{owner}/{repo}/hooks` vers `{instance_url}/api/v1/webhooks/github` (nécessite scope `admin:repo_hook` sur le PAT + `instance_url` renseigné).
3. Les webhooks push restent le chemin temps réel ; le poller est le filet.

## Conclusion

Cause historique : le toggle `auto_deploy` filtrait seulement les webhooks, sans webhook GitHub ni polling — l'UI montrait des commits « à déployer » sans jamais déployer.
