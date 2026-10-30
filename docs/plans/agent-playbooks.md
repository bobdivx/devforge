# Modèles d'agent (playbooks), carte live, journal et réveil du bot Grok

Objectif : lancer un travail d'agent **en un bouton**, voir sa progression réelle en direct
et pouvoir réveiller un bot Grok externe quand un run ou une mise en ligne échoue.
Tout réutilise l'existant : Coordinateur du projet (`agent_runs`), workers (`delegate_task`),
événements (`agent_run_events`), reçus d'accord (`approval_receipts`), garde SSRF de page-watch,
`secret_box` pour les secrets.

## 1. Bibliothèque de modèles

`GET /api/v1/playbooks` — catalogue statique (`apps/server/src/playbooks.rs`) :

| Commande | Nom | Règle |
|---|---|---|
| `/deploy-verify` | Déployer & vérifier | Un résultat manquant ne compte jamais comme un succès. |
| `/figure-it-out` | Enquêter sur un échec de mise en ligne | Une preuve est un lien ou un chemin, jamais un paragraphe. |
| `/watch-page` | Surveiller une page (URL facultative) | Un résultat manquant ne compte jamais comme un succès. |
| `/swarm` | Essaim d'agents parallèles (objectif facultatif) | Un résultat manquant ne compte jamais comme un succès. |
| `/reflect` | Retour d'expérience | Une preuve est un lien ou un chemin, jamais un paragraphe. |

Chaque modèle : description, **3 étapes fixes**, une règle, un champ facultatif d'une ligne.

`POST /api/v1/projects/{project}/playbooks/{id}/run` `{goal?}` → message au Coordinateur
(commande, 3 étapes, règle, consignes outils) puis démarrage immédiat du run, marqué
`agent_runs.playbook = id`. 409 si le Coordinateur travaille déjà.

## 2. Carte live

`GET /api/v1/agent/runs/{run}/live` — calcul pur (`compute_live`) depuis le run, ses workers
(`parent_run_uuid`), ses événements et ses reçus :

- `status_text` : outil en cours (« Vérifie https://… »), jalon, « En file d'attente… », « 2 worker(s) en cours… », « Terminé », « Échec : … ».
- `steps[3]` : `pending | running | ok | failed | skipped | missing`. Une étape n'est `ok` **que** si l'agent l'a
  notée avec une preuve (`record_decision`). Run terminé sans preuve → `missing`, verdict `incomplete`.
  `/swarm` : l'étape 3 suit les workers réels.
- `workers[]`, `counters` (actions OK / en échec, workers, décisions), `decisions[]`.

Site : tuile **Modèles** (hub Agents du projet) → modale ; carte aussi dans « En cours » pour un run de modèle.
Android : tuile **Modèles** sur la page app → feuille. Sondage toutes les 2,5 s tant que le run vit.

## 3. « Montre-moi ton travail »

Nouvel outil agent `record_decision {what, why, evidence, outcome: ok|failed|skipped, step?}`.
La preuve est refusée si ce n'est pas **un seul** lien http(s) ou un chemin (pas de paragraphe, pas de `javascript:`).
Le journal fusionne ces décisions et les reçus d'accord du run (preuve = `/app/receipts#<uuid>`).

## 4. Arène — limite assumée (non livrée)

Une arène honnête (plusieurs agents, juge d'une autre famille de modèles) suppose de choisir le modèle par worker.
`delegate_task` ne le permet pas aujourd'hui : tous les workers utilisent le modèle du projet. Plutôt qu'un faux
juge, l'arène n'est pas proposée. À faire : paramètre `model` par worker + juge imposé d'un autre fournisseur.

## 5. Réveil du bot Grok

Réglage par espace : **Réglages → Bot Grok** (URL du webhook + clé d'envoi).

- URL et clé sont chiffrées (`secret_box`) ; l'API ne renvoie jamais la clé ni l'URL complète (seulement `https://hôte/…`).
- URL : `https://` publique uniquement ; la résolution DNS passe par la même garde que page-watch (adresses
  privées, loopback, link-local, métadonnées cloud refusées), redirections **non suivies**, pas de proxy.
- Envoi : un seul essai, 8 s max, corps de réponse jamais relayé. Au plus un réveil toutes les 5 s par espace.

Boutons « Réveiller le bot Grok » : carte live, run en échec dans « En cours », mise en ligne en échec
(Déploiements). Bouton « Tester » dans le réglage. Le résultat (HTTP, message) s'affiche sous le bouton.

`POST /api/v1/grok-bot/wake` `{project_uuid, run_uuid?, deployment_uuid?, message?}` envoie :

```http
POST <url du webhook>
Content-Type: application/json
Authorization: Bearer <clé d'envoi>
X-Automation-Key: <clé d'envoi>

{
  "event": "devforge.run_failed",      // devforge.run_failed | devforge.deploy_failed | devforge.wake | devforge.test
  "project": { "uuid": "…", "name": "…", "url": "https://…" },
  "run": { "type": "agent_run", "uuid": "…", "status": "failed", "title": "/deploy-verify · Déployer & vérifier", "error": "…", "summary": null },
  "message": "Texte court lisible par le bot (2000 caractères max)"
}
```

Pour une mise en ligne, `run` vaut `{"type": "deployment", "uuid", "status", "title" (message du commit), "error"}` ;
`null` pour un réveil simple ou un test (`project` vaut aussi `null` pour `devforge.test`).
Réponse 2xx = réveil accepté ; 401/403 = clé refusée ; 3xx = redirection refusée.

## Tests

- Rust : catalogue, prompt, états d'étapes (manquant ≠ succès), essaim, statut, journal, preuve, refus SSRF
  (127.0.0.1, 10.x, 169.254.169.254, http://), en-têtes de clé, redirection non suivie, clé jamais renvoyée.
- Web : `lib/run-live.test.ts`, `components/RunLiveCard.test.tsx`.
- Android : `PlaybooksTest` (parsing, pastilles, preuve).
