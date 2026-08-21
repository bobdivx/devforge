# 🔍 Rapport QA DevForge UI — Production https://web.briseteia.me

**Date** : 2026-08-21  
**Contexte** : Projet ZIMAOS, équipe Root, utilisateur bobdivx  
**Repository** : bobdivx/devforge (fork Coolify)  

---

## ✅ Correctifs implémentés (6/8 symptômes)

### 🔒 CRITIQUE : Masquage des secrets (Symptôme 7)

**Problème** : Les tokens Bearer et API keys apparaissaient en clair dans les commandes cron du tableau des tâches planifiées.

**Solution** :
- Nouveau helper `frontend/src/lib/secret-masking.ts` avec fonction `maskSecretsInText()`
- Intégré dans `ApplicationScheduledTasksPanel.tsx`
- Patterns détectés :
  - Bearer tokens : `Bearer xxx` → `Bearer ••••••`
  - Variables d'environnement : `API_KEY=xxx`, `TOKEN=xxx`, `PASSWORD=xxx` → masqués
  - Supporte formats avec/sans guillemets

**Impact** : Masquage côté présentation uniquement, secrets restent accessibles via API pour édition.

---

### 🇫🇷 Traduction & UX (Symptômes 3, 5, 6, 8)

#### Symptôme 3 : Titres de document incohérents
- `/connexions/` : "Tokens & Clés API" → **"Connexions"** (cohérent avec nav)
- `/settings/servers/` : "Paramètres" → **"Serveurs"**
- `/settings/projects/` : "Paramètres" → **"Projets"**

**Fichier modifié** : `frontend/src/lib/routing/routes.ts`

#### Symptôme 5 : Grammaire française incorrecte
- "Rechercher un application" → **"Rechercher une application"**
- "Rechercher un bases de donnée" → **"Rechercher une base de données"**

**Fichier modifié** : `frontend/src/pages/resources/_CoreResourcesPage.tsx`

#### Symptôme 6 : Message 404 en anglais
- "Resource not found." → **"Ressource introuvable."**

**Fichier modifié** : `backend/app/Http/Controllers/DevForge/Core/ResourceController.php`

#### Symptôme 8 : Message disque ambigu
- "Racine / à 100 % (CasaOS)" → **"Partition racine (inodes) saturée — Docker sur autre partition"**
- Clarifie que Docker (15%) est sur une partition différente

**Fichier modifié** : `frontend/src/components/storage/ServerStorageCard.tsx`

---

### 🔍 Paramètre de recherche URL (Symptôme 4)

**Problème** : `/applications/?q=popcorn` ne filtrait pas la liste au chargement.

**Solution** : Initialisation du state `search` depuis `new URLSearchParams(window.location.search).get('q')`

**Fichier modifié** : `frontend/src/pages/resources/_CoreResourcesPage.tsx`

---

## 🚧 Problèmes identifiés mais NON corrigés (2/8 symptômes)

### 1️⃣ Status mismatch : Apps healthy vs "En alerte" (Symptôme 1)

**Symptôme observé** :
- `/applications/` et `/monitoring/` : 10/11 apps online
- `/deployments/` : 8/11 apps "En alerte — URL injoignable"
- HTTP GET manuel : 8 apps retournent 200, 1 app (Blab) retourne 404

**Analyse technique** :

#### Source de données 1 : Status Docker (`/applications/`, `/monitoring/`)
```php
// backend/app/Services/DevForge/ResourceStatusData.php
$application->status; // Lit directement le champ Application.status
```
→ Reflète le statut du conteneur Docker (`running`, `stopped`, `exited`)

#### Source de données 2 : Probe HTTP réel (`/deployments/`)
```php
// backend/app/Services/DevForge/DeploymentTopologyData.php:204-206
$probeUrl = $this->domainProbe->primaryUrl($application);
$reachable = $readiness?->last_probe_ok; // ApplicationReadiness.last_probe_ok

// backend/app/Services/DevForge/Readiness/ApplicationDomainProbe.php:44-48
$response = Http::timeout($timeout)
    ->get($url); // Probe HTTP réel vers l'URL publique
```
→ Vérifie que l'URL publique répond 200-399 via HTTP GET

**Résultat** : Une app peut avoir un conteneur Docker `running` mais être inaccessible via son URL publique.

**Causes possibles** :
1. **Proxy Traefik** : Labels Docker incorrects, certificat SSL expiré, règles de routage KO
2. **DNS** : FQDN ne pointe pas vers le bon serveur
3. **Firewall** : Ports 80/443 bloqués sur le serveur
4. **Health check** : Le conteneur est `running` mais n'écoute pas sur le bon port
5. **Logs d'erreur** : Conteneur démarre mais crash immédiatement (status=`running` pendant 1-2s)

**Diagnostic requis (accès production nécessaire)** :
```bash
# 1. Vérifier labels Traefik sur conteneur suspect
docker inspect <container-name> | grep -A 20 Labels

# 2. Tester résolution DNS
nslookup teslarep.briseteia.me

# 3. Vérifier logs proxy Traefik
docker logs traefik | grep teslarep

# 4. Tester connectivity depuis le serveur
curl -I https://teslarep.briseteia.me

# 5. Inspecter table application_readiness
SELECT application_id, last_probe_ok, last_probe_error, last_http_status 
FROM application_readiness 
WHERE last_probe_ok = 0;
```

**Pourquoi hors scope PR UI** :
- Nécessite accès SSH production et logs temps réel
- Problème infrastructure/configuration, pas UI
- Correction potentielle : régénération labels Traefik, reload proxy, fix DNS

---

### 2️⃣ Onglet Logs bloqué sur "Chargement…" (Symptôme 2)

**Symptôme observé** :
- `/applications/{uuid}/?tab=logs` reste >25s sur "Chargement…"
- Aucune erreur réseau visible dans DevTools
- Aucun timeout HTTP

**Analyse technique** :

#### Route API backend
```php
// backend/routes/devforge-applications.php:26
Route::get('/applications/{applicationUuid}/logs', [ApplicationController::class, 'logs']);

// backend/app/Http/Controllers/DevForge/ApplicationController.php:122-126
public function logs(string $applicationUuid): JsonResponse
{
    $application = Application::query()->where('uuid', $applicationUuid)->firstOrFail();
    $data = $this->applicationContainerLogs->fetch($application);
    return response()->json($data);
}
```

#### Service backend (point de blocage probable)
```php
// backend/app/Services/DevForge/Application/ApplicationContainerLogs.php:24
$containers = getCurrentApplicationContainerStatus($server, $application->id);
// ↑ Cette fonction fait un appel SSH au serveur Docker
```

**Causes possibles** :
1. **Timeout SSH** : Connexion au serveur Docker timeout (>25s)
2. **Fonction helper bloquante** : `getCurrentApplicationContainerStatus()` sans timeout configuré
3. **Error silencieux** : Exception catchée sans log ni retour JSON
4. **WebSocket Soketi** : Port 6001 bloqué par firewall (hypothèse initiale)

**Diagnostic requis (accès production nécessaire)** :
```bash
# 1. Tester connectivité SSH depuis le serveur DevForge vers le serveur Docker
ssh -v <docker-server-ip> -p <port> "docker ps"

# 2. Activer logs debug Laravel
tail -f storage/logs/laravel.log

# 3. Inspecter les appels API dans les logs
grep "GET /api/devforge/v1/applications/.*/logs" storage/logs/laravel.log

# 4. Vérifier timeout HTTP côté frontend
# frontend/src/lib/hooks/use-api-query.ts
# Chercher timeout configuration

# 5. Tester l'endpoint API en direct
curl -H "Authorization: Bearer <token>" \
  https://web.briseteia.me/api/devforge/v1/applications/kq5rr0s1qn0hkcs58gflvljk/logs
```

**Hypothèse WebSocket Soketi (invalidée)** :
- Livewire `Logs.php` utilise Soketi pour streaming temps réel
- Mais l'endpoint API REST `/logs` est synchrone et ne devrait pas dépendre de WebSocket
- Le frontend `ApplicationLogsPanel.tsx` utilise `useApiQuery` (fetch HTTP classique)

**Pourquoi hors scope PR UI** :
- Nécessite tests réseau sur instance production
- Problème backend/infrastructure, pas UI
- Correction potentielle : timeout SSH, error handling, logs debug

---

## 📦 Fichiers modifiés dans la PR

### Backend (1 fichier)
- `app/Http/Controllers/DevForge/Core/ResourceController.php`

### Frontend (5 fichiers)
- `components/applications/ApplicationScheduledTasksPanel.tsx`
- `components/storage/ServerStorageCard.tsx`
- `lib/routing/routes.ts`
- `lib/secret-masking.ts` (**NOUVEAU**)
- `pages/resources/_CoreResourcesPage.tsx`

---

## 🔐 Considérations sécurité

**Masquage secrets** :
- Implémenté côté présentation uniquement (UI)
- Secrets restent accessibles via API pour utilisateurs autorisés
- Aucun secret n'a été loggé, printé ou commité dans cette PR
- Helper `maskSecretsInText()` est réutilisable pour d'autres composants

**Regex patterns détectés** :
- Bearer tokens : `/\b(bearer)\s+([a-z0-9\-._~+/]+)/gi`
- Variables sensibles : `/(api[_-]?key|token|password|passwd|secret|bearer[_-]?token|auth[_-]?token|access[_-]?token|jwt)/i`

---

## 🧪 Tests suggérés post-merge

### Tests UI
1. **Masquage secrets** : Vérifier que les tokens sont masqués dans `/applications/{uuid}/?tab=scheduled-tasks`
2. **Recherche** : Tester `/applications/?q=popcorn` et `/bases-de-donnee/?q=postgres`
3. **Titres** : Vérifier onglet navigateur sur `/connexions/`, `/settings/servers/`, `/settings/projects/`
4. **Grammaire** : Vérifier placeholders de recherche (applications, bases de données)
5. **Message disque** : Vérifier `/storage/` affiche le bon message

### Tests réseau (production)
6. **Status mismatch** : Investiguer pourquoi TeslaReports, aline-farm, etc. sont "En alerte" alors que conteneurs `running`
7. **Logs** : Diagnostiquer pourquoi `/applications/sonozz/logs` timeout après 25s

---

## 📊 Résumé

| Symptôme | Priorité | Status | Type |
|----------|----------|--------|------|
| 1. Status mismatch apps | MAJEUR | ⚠️ Hors scope | Infrastructure |
| 2. Logs bloqués | MAJEUR | ⚠️ Hors scope | Backend |
| 3. Titres document | MINEUR | ✅ Corrigé | Frontend |
| 4. Recherche ?q= | MINEUR | ✅ Corrigé | Frontend |
| 5. Grammaire française | MINEUR | ✅ Corrigé | Frontend |
| 6. Message 404 anglais | MINEUR | ✅ Corrigé | Backend |
| 7. Secrets en clair | SÉCURITÉ | ✅ Corrigé | Frontend |
| 8. Message disque | MINEUR | ✅ Corrigé | Frontend |

**Bilan** : 6/8 symptômes corrigés. Les 2 problèmes majeurs nécessitent un accès production et sont liés à l'infrastructure/backend, pas à l'UI.

---

## 🚀 Prochaines étapes

1. **Merge cette PR** : Correctifs UI critiques + masquage secrets
2. **Accès production** : Diagnostiquer status mismatch et logs timeout
3. **Monitoring** : Ajouter logs debug sur `ApplicationContainerLogs.php` et `ApplicationDomainProbe.php`
4. **Documentation** : Créer playbook pour diagnostiquer probe HTTP vs status Docker mismatch
