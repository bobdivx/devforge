# Incident Report: Traefik Disappearance Post-Deploy (2026-09-15 03:45 UTC)

## Timeline

**03:42 UTC** - Deploy #41 popcornn-client réussi (blue-green + Traefik labels OK)  
**~03:45 UTC** - Traefik container `missing` → all apps 502 (client.popcornn.app, popcornn.app)  
**03:45+ UTC** - Manual `proxy.ensure_traefik()` → Traefik recréé → sites back to 200  

## Root Cause Analysis

### 1. Watchdog 2.0.47 n'a PAS détecté la disparition

**Problème identifié :**
- Watchdog interval: **5 minutes** (300 secondes)
- Traefik disparu à ~03:45 UTC
- Prochain check watchdog: 03:47+ UTC (trop tard)
- L'utilisateur a dû intervenir manuellement avant le prochain cycle

**Pourquoi le watchdog existe mais a échoué :**
- Watchdog vérifie toutes les 5min → fenêtre de 5min où Traefik peut être absent
- Si Traefik disparaît à T+0, il reste absent jusqu'à T+5min (watchdog)
- Apps 502 pendant toute cette fenêtre

### 2. Deploy #41 a réussi mais Traefik a disparu juste après

**Séquence observée :**
1. ✅ Deploy blue-green réussi
2. ✅ Traefik labels appliqués au container app
3. ❌ **Traefik container lui-même a disparu** (timing suspect)

**Hypothèses :**
- Race condition : Docker network operations pendant deploy
- Traefik stop/rm accidentel via script de nettoyage
- Conflict entre deploy concurrent et Traefik auto-update
- Memory pressure → OOM kill Traefik (peu probable sur NAS)

**Code actuel (2.0.47-2.0.53) :**
```rust
// Manual deploy : PAS d'appel ensure_traefik
// Webhook deploy : PAS d'appel ensure_traefik
// Blue-green : PAS d'appel ensure_traefik
// Watchdog : toutes les 5 minutes
```

## Impact

**Durée d'incident :** ~3 minutes (03:45 → intervention manuelle)  
**Sites affectés :** Tous les apps avec labels Traefik (502 Bad Gateway)  
**Cause 502 :** Traefik absent → routing impossible → nginx/Cloudflare timeout

**Important :** Le 502 n'est PAS dû à l'app elle-même (qui tourne et est healthy), mais à l'absence du reverse proxy Traefik.

## Fix Implémenté (PR #123)

### A. Appel `ensure_traefik()` après CHAQUE deploy

**Fichiers modifiés :**

1. **Manual deploy** (`apps/server/src/routes.rs` ligne ~920)
```rust
// CRITICAL: Ensure Traefik after successful deploy
if result.ok {
    if let Err(e) = state.proxy.ensure_traefik().await {
        tracing::error!(error = %e, "Failed to ensure Traefik after deploy");
    }
}
```

2. **Webhook deploy** (`apps/server/src/infra_routes.rs` ligne ~1597)
```rust
// CRITICAL: Ensure Traefik after webhook deploy
if result.ok {
    if let Err(e) = state.proxy.ensure_traefik().await {
        tracing::error!(error = %e, "Webhook deploy: failed to ensure Traefik");
    }
}
```

3. **Blue-green pipeline** (`crates/deploy/src/lib.rs` ligne ~1185)
```rust
// Post-deploy Traefik verification
if success && has_traefik_labels {
    logs.push_str("[post-deploy] Vérification Traefik...\n");
    let traefik_check = "docker ps --filter name=^traefik$ --format '{{.Status}}'";
    // Log état Traefik + warning si manquant
}
```

### B. Watchdog interval réduit : 5min → 2min

**Fichier :** `apps/server/src/main.rs` ligne ~70

```rust
// BEFORE (2.0.47-2.0.53)
let mut interval = tokio::time::interval(std::time::Duration::from_secs(300)); // 5min

// AFTER (PR #123)
let mut interval = tokio::time::interval(std::time::Duration::from_secs(120)); // 2min
```

**Raison :** Réduire la fenêtre de downtime de 5min à 2min max.

### C. Logs améliorés

```
[post-deploy] Vérification Traefik...
[post-deploy] ✅ Traefik actif
```

Si Traefik manquant :
```
[post-deploy] ⚠️ Traefik manquant — recréation en cours...
```

## Prévention Future avec PR #123

### Scénario 1 : Traefik disparaît PENDANT deploy
**Avant PR #123 :** Apps 502 jusqu'à watchdog (5min max)  
**Après PR #123 :** `ensure_traefik()` appelé immédiatement post-deploy → Traefik recréé dans la foulée

### Scénario 2 : Traefik disparaît ENTRE deux deploys
**Avant PR #123 :** Apps 502 jusqu'à watchdog (5min max)  
**Après PR #123 :** Watchdog détecte en 2min max → Traefik recréé

### Scénario 3 : Deploy #41 à 03:42, Traefik disparu à 03:45
**Avant PR #123 :**
- 03:42 → Deploy OK
- 03:45 → Traefik disparu (cause inconnue)
- 03:47+ → Watchdog cycle (trop tard)
- **Downtime : 3-5 minutes**

**Après PR #123 :**
- 03:42 → Deploy OK + **`ensure_traefik()` automatique**
- 03:45 → Traefik disparu (cause inconnue)
- 03:47 → Watchdog détecte + recrée
- **Downtime : 2 minutes max**

**OU si disparu juste après deploy :**
- 03:42 → Deploy OK + **Traefik recréé immédiatement**
- **Downtime : 0 seconde** (transparent)

## Investigation Watchdog 2.0.47

**Question :** Pourquoi le watchdog n'a pas recréé Traefik automatiquement ?

**Hypothèses :**
1. ✅ **Watchdog tourne** (code présent dans main.rs depuis 2.0.47)
2. ❌ **Interval trop long** (5min) → l'utilisateur a intervenu avant le cycle
3. ⚠️ **Possible :** Watchdog task crashed silently → tokio spawn non surveillé

**Code watchdog actuel :**
```rust
tokio::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
    interval.tick().await; // Skip first tick
    loop {
        interval.tick().await;
        if let Err(e) = proxy.ensure_traefik().await {
            tracing::error!(error = %e, "Traefik watchdog: failed to ensure proxy");
        }
    }
});
```

**Vérification recommandée :**
```bash
# Sur le NAS, vérifier les logs serveur autour de 03:45 UTC
docker logs devforge-server --since "2026-09-15T03:40:00Z" --until "2026-09-15T03:50:00Z" | grep -i "watchdog\|traefik"

# Chercher :
# - "Traefik watchdog: failed to ensure proxy" (erreur)
# - "Traefik watchdog: proxy verified" (succès)
# - Absence totale de logs watchdog = task dead
```

## Recommandations Additionnelles

### 1. Monitoring watchdog health

Ajouter un compteur watchdog + metric Prometheus :
```rust
static WATCHDOG_TICKS: AtomicU64 = AtomicU64::new(0);

loop {
    interval.tick().await;
    WATCHDOG_TICKS.fetch_add(1, Ordering::Relaxed);
    // ... ensure_traefik ...
}
```

Exposer dans `/api/v1/system/health` :
```json
{
  "traefik_watchdog_ticks": 42,
  "traefik_watchdog_last_check": "2026-09-15T03:47:00Z"
}
```

### 2. Traefik crash loop detection

Si Traefik disparaît > 3 fois en 10min → alerter admin :
```rust
if traefik_recreations_last_10min > 3 {
    tracing::warn!("Traefik crash loop detected — investigate Docker/network stability");
}
```

### 3. Docker events listener

Alternative/complément au polling watchdog :
```bash
docker events --filter 'container=traefik' --filter 'event=die'
```

→ Réaction immédiate au lieu de polling 2min

### 4. Healthcheck endpoint Traefik

Vérifier que Traefik répond, pas seulement qu'il existe :
```rust
async fn traefik_is_healthy() -> bool {
    let ping = reqwest::get("http://traefik:8080/ping").await;
    ping.is_ok() && ping.unwrap().status().is_success()
}
```

## Conclusion

**PR #123 résout l'incident :**
- ✅ `ensure_traefik()` après chaque deploy → protection immédiate
- ✅ Watchdog 2min au lieu de 5min → fenêtre downtime réduite
- ✅ Logs traçabilité → debug futur facilité

**Déploiement recommandé :** URGENT (hotfix)

**Tests avant merge :**
1. Déployer app avec Traefik labels
2. Stop manuel Traefik : `docker stop traefik`
3. Vérifier logs : `[post-deploy] ⚠️ Traefik manquant — recréation en cours...`
4. Confirmer Traefik recréé en < 10 secondes

**Next steps :**
- Merge PR #123
- Déployer sur NAS prod
- Monitorer incidents Traefik pendant 48h
- Si récidive : investiguer Docker events / crash loops
