//! Boucle spec-driven (constitution + spec / plan / tâches) dans le workdir.
//! Les fichiers sont sous `specs/` pour pouvoir être commités. Aucun dépôt distant n'est créé ici.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const MAX_ATTEMPTS: u32 = 3;

pub const PHASE_AWAITING: &str = "awaiting_validation";
pub const PHASE_IMPLEMENT: &str = "implement";
pub const PHASE_CONVERGED: &str = "converged";
pub const PHASE_FAILED: &str = "failed";
pub const PHASE_REJECTED: &str = "rejected";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Yes,
    No,
    /// Échec explicite : on n'enchaîne pas un nouvel essai.
    Fail,
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FeatureStatus {
    pub slug: String,
    pub title: String,
    pub phase: String,
    pub attempts: u32,
    #[serde(default)]
    pub worker_uuid: String,
    #[serde(default)]
    pub note: String,
    pub updated_at: String,
}

pub fn is_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 48
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
}

pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in title.chars() {
        let c = c.to_lowercase().next().unwrap_or(c);
        let c = match c {
            'à' | 'á' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other.to_ascii_lowercase(),
        };
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= 48 {
            break;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "fonctionnalite".into()
    } else {
        out
    }
}

pub fn constitution_markdown() -> String {
    "\
# Constitution du projet

Principes non négociables, pour toute fonctionnalité :

1. **Qualité** — le comportement livré correspond à la spec validée. Pas de raccourci qui contredit un critère d'acceptation.
2. **Tests** — chaque changement observable a un test ou une vérification reproductible. Un échec de test bloque la convergence.
3. **Maintenabilité** — code lisible, noms explicites, pas de duplication inutile. Quelqu'un d'autre doit pouvoir reprendre le fil sans contexte oral.

Cette constitution est écrite une fois. Les specs de fonctionnalité ne la contredisent pas.
"
    .to_string()
}

fn specs_root(workdir: &Path) -> PathBuf {
    workdir.join("specs")
}

fn feature_dir(workdir: &Path, slug: &str) -> Result<PathBuf, String> {
    if !is_slug(slug) {
        return Err("slug invalide".into());
    }
    Ok(specs_root(workdir).join(slug))
}

pub fn ensure_constitution(workdir: &Path) -> io::Result<bool> {
    let path = specs_root(workdir).join("constitution.md");
    if path.exists() {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, constitution_markdown())?;
    Ok(true)
}

fn now_stamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn write_status_file(dir: &Path, status: &FeatureStatus) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let raw = serde_json::to_string_pretty(status).map_err(io::Error::other)?;
    fs::write(dir.join("status.json"), raw + "\n")
}

pub fn read_status(workdir: &Path, slug: &str) -> Result<Option<FeatureStatus>, String> {
    let dir = feature_dir(workdir, slug)?;
    let path = dir.join("status.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn write_status(workdir: &Path, status: &FeatureStatus) -> Result<(), String> {
    let dir = feature_dir(workdir, &status.slug)?;
    write_status_file(&dir, status).map_err(|e| e.to_string())
}

fn unique_slug(workdir: &Path, base: &str) -> Result<String, String> {
    if !feature_dir(workdir, base)?.exists() {
        return Ok(base.to_string());
    }
    for n in 2..50 {
        let candidate = {
            let suffix = format!("-{n}");
            let keep = 48usize.saturating_sub(suffix.len());
            format!("{}{suffix}", &base[..base.len().min(keep)])
        };
        if !is_slug(&candidate) {
            continue;
        }
        if !feature_dir(workdir, &candidate)?.exists() {
            return Ok(candidate);
        }
    }
    Err("trop de specs avec ce titre".into())
}

pub fn specify(workdir: &Path, title: &str, description: &str) -> Result<FeatureStatus, String> {
    let title = title.trim();
    let description = description.trim();
    if title.is_empty() || description.is_empty() {
        return Err("titre et description requis".into());
    }
    ensure_constitution(workdir).map_err(|e| e.to_string())?;
    let base = slugify(title);
    let slug = unique_slug(workdir, &base)?;
    let dir = feature_dir(workdir, &slug)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let spec = format!(
        "\
# {title}

## Intention

{description}

## Critères d'acceptation

- Le comportement décrit ci-dessus est observable dans le workdir local.
- La constitution du projet (qualité, tests, maintenabilité) est respectée.
- Aucun dépôt distant n'est créé tant que l'utilisateur n'a pas validé une publication, séparément de cette spec.

## Hors périmètre

- Publication distante, pull request, déploiement : interdits tant que la spec n'est pas validée, puis tant qu'une publication n'est pas demandée explicitement.
"
    );
    fs::write(dir.join("spec.md"), spec).map_err(|e| e.to_string())?;
    let status = FeatureStatus {
        slug,
        title: title.to_string(),
        phase: PHASE_AWAITING.to_string(),
        attempts: 0,
        worker_uuid: String::new(),
        note: "Spec écrite. En attente de validation avant tout code.".into(),
        updated_at: now_stamp(),
    };
    write_status_file(&dir, &status).map_err(|e| e.to_string())?;
    Ok(status)
}

pub fn approve(workdir: &Path, slug: &str) -> Result<FeatureStatus, String> {
    let Some(mut status) = read_status(workdir, slug)? else {
        return Err("spec introuvable".into());
    };
    if status.phase != PHASE_AWAITING {
        return Err(format!(
            "validation impossible : phase actuelle « {} »",
            status.phase
        ));
    }
    let dir = feature_dir(workdir, slug)?;
    let plan = format!(
        "\
# Plan — {title}

Spec validée. Implémentation locale uniquement.

1. Lire `specs/{slug}/spec.md` et `specs/constitution.md`.
2. Implémenter le comportement dans le workdir, sans créer de dépôt distant.
3. Ajouter ou lancer un test / une vérification reproductible.
4. Écrire `specs/{slug}/convergence.md` : première ligne `CONVERGED: yes` ou `CONVERGED: no`, puis la preuve (test) ou l'écart restant.

slug : `{slug}`
",
        title = status.title,
        slug = slug
    );
    let tasks = format!(
        "\
# Tâches — {title}

- [ ] Lire la spec et la constitution
- [ ] Implémenter en local, conformément aux critères d'acceptation
- [ ] Vérifier par un test ou une commande reproductible
- [ ] Écrire `specs/{slug}/convergence.md` (`CONVERGED: yes` ou `CONVERGED: no`)
- [ ] Ne pas publier, ne pas ouvrir de pull request, ne pas déployer
",
        title = status.title,
        slug = slug
    );
    fs::write(dir.join("plan.md"), plan).map_err(|e| e.to_string())?;
    fs::write(dir.join("tasks.md"), tasks).map_err(|e| e.to_string())?;
    status.phase = PHASE_IMPLEMENT.to_string();
    status.attempts = 1;
    status.note = "Spec validée. Plan et tâches écrits. Implémentation locale.".into();
    status.updated_at = now_stamp();
    write_status_file(&dir, &status).map_err(|e| e.to_string())?;
    Ok(status)
}

pub fn reject(workdir: &Path, slug: &str, note: &str) -> Result<FeatureStatus, String> {
    let Some(mut status) = read_status(workdir, slug)? else {
        return Err("spec introuvable".into());
    };
    if status.phase != PHASE_AWAITING {
        return Err(format!(
            "rejet impossible : phase actuelle « {} »",
            status.phase
        ));
    }
    status.phase = PHASE_REJECTED.to_string();
    let note = note.trim();
    status.note = if note.is_empty() {
        "Spec rejetée. Aucun code.".into()
    } else {
        note.to_string()
    };
    status.updated_at = now_stamp();
    write_status(workdir, &status)?;
    Ok(status)
}

pub fn parse_verdict(text: &str) -> Verdict {
    let line = text
        .lines()
        .find(|l| l.trim().to_ascii_lowercase().starts_with("converged:"))
        .unwrap_or("");
    let value = line
        .split_once(':')
        .map(|(_, v)| v.trim().to_ascii_lowercase())
        .unwrap_or_default();
    match value.as_str() {
        "yes" | "oui" | "true" => Verdict::Yes,
        "fail" | "échec" | "echec" | "abort" => Verdict::Fail,
        "no" | "non" | "false" => Verdict::No,
        _ => Verdict::Missing,
    }
}

pub fn read_verdict(workdir: &Path, slug: &str) -> Result<Verdict, String> {
    let path = feature_dir(workdir, slug)?.join("convergence.md");
    if !path.exists() {
        return Ok(Verdict::Missing);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let verdict = parse_verdict(&raw);
    if verdict == Verdict::Missing {
        Ok(Verdict::No)
    } else {
        Ok(verdict)
    }
}

/// Met à jour la phase après comparaison au fichier de convergence.
/// `Retry` signifie qu'un nouvel essai d'implémentation est encore permis.
pub fn apply_verdict(status: &FeatureStatus, verdict: Verdict) -> Result<FeatureStatus, String> {
    if status.phase != PHASE_IMPLEMENT {
        return Err(format!(
            "convergence impossible : phase actuelle « {} »",
            status.phase
        ));
    }
    let mut next = status.clone();
    next.updated_at = now_stamp();
    match verdict {
        Verdict::Yes => {
            next.phase = PHASE_CONVERGED.to_string();
            next.note = "Le résultat correspond à la spec.".into();
        }
        Verdict::Fail => {
            next.phase = PHASE_FAILED.to_string();
            next.note = "Échec explicite, boucle arrêtée.".into();
        }
        Verdict::No | Verdict::Missing => {
            if status.attempts >= MAX_ATTEMPTS {
                next.phase = PHASE_FAILED.to_string();
                next.note = if verdict == Verdict::Missing {
                    "Pas de convergence.md après le nombre d'essais maximum.".into()
                } else {
                    "Toujours écarté de la spec après le nombre d'essais maximum.".into()
                };
            } else {
                next.attempts = status.attempts.saturating_add(1);
                next.phase = PHASE_IMPLEMENT.to_string();
                next.note = if verdict == Verdict::Missing {
                    format!(
                        "convergence.md absent — nouvel essai {}/{MAX_ATTEMPTS}.",
                        next.attempts
                    )
                } else {
                    format!(
                        "Pas encore aligné sur la spec — nouvel essai {}/{MAX_ATTEMPTS}.",
                        next.attempts
                    )
                };
            }
        }
    }
    Ok(next)
}

pub fn list_features(workdir: &Path) -> Result<Vec<FeatureStatus>, String> {
    let root = specs_root(workdir);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        if !is_slug(&name) {
            continue;
        }
        if let Some(status) = read_status(workdir, &name)? {
            out.push(status);
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

pub fn implement_prompt(slug: &str, title: &str, attempt: u32) -> String {
    format!(
        "\
SDD-IMPLEMENT:{slug}:attempt={attempt}

Tu implémentes la fonctionnalité « {title} » (essai {attempt}/{max}).
Lis specs/constitution.md, specs/{slug}/spec.md, specs/{slug}/plan.md et specs/{slug}/tasks.md.
Travaille uniquement dans le workdir local (write_project_file mode=local, run_workdir_command).
Interdit : créer un dépôt, une pull request, publier, ou déployer.
Quand les fichiers sont en place, appelle start_local_preview pour une preview locale.
Quand tu as fini, écris specs/{slug}/convergence.md.
La première ligne doit être exactement `CONVERGED: yes` ou `CONVERGED: no`.
Si un blocage clair empêche de continuer, écris `CONVERGED: fail` et la raison.
La suite du fichier explique la preuve (test lancé) ou l'écart restant par rapport à la spec.
",
        max = MAX_ATTEMPTS
    )
}

/// Cible du tour à lancer juste après un approve qui vient d'enfiler le worker.
/// `None` si le worker existait déjà, ou si l'approve n'a pas abouti.
pub fn queued_worker(result: &serde_json::Value) -> Option<(String, String)> {
    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    if result.get("worker_started").and_then(|v| v.as_bool()) != Some(true) {
        return None;
    }
    let project = result
        .get("project_uuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let worker = result
        .get("worker_uuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if project.is_empty() || worker.is_empty() {
        None
    } else {
        Some((project.to_string(), worker.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("devforge-sdd-{n}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn slug_and_constitution_once() {
        assert_eq!(slugify("Éditer le profil !"), "editer-le-profil");
        assert!(is_slug(&slugify("Éditer le profil !")));
        assert!(!is_slug("../etc"));
        let dir = scratch();
        assert!(ensure_constitution(&dir).unwrap());
        let path = dir.join("specs/constitution.md");
        let first = fs::read_to_string(&path).unwrap();
        assert!(first.contains("Qualité"));
        assert!(first.contains("Tests"));
        assert!(first.contains("Maintenabilité"));
        fs::write(&path, "modifié\n").unwrap();
        assert!(!ensure_constitution(&dir).unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), "modifié\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn queued_worker_only_when_just_started() {
        let started = serde_json::json!({
            "ok": true,
            "worker_started": true,
            "project_uuid": "p",
            "worker_uuid": "w"
        });
        assert_eq!(queued_worker(&started), Some(("p".into(), "w".into())));
        let again = serde_json::json!({
            "ok": true,
            "worker_started": false,
            "project_uuid": "p",
            "worker_uuid": "w"
        });
        assert!(queued_worker(&again).is_none());
        let failed = serde_json::json!({
            "ok": false,
            "worker_started": true,
            "project_uuid": "p",
            "worker_uuid": "w"
        });
        assert!(queued_worker(&failed).is_none());
    }

    #[test]
    fn specify_stops_before_plan() {
        let dir = scratch();
        let status = specify(&dir, "Page d'accueil", "Afficher un titre.").unwrap();
        assert_eq!(status.phase, PHASE_AWAITING);
        assert!(dir.join("specs/constitution.md").is_file());
        assert!(dir.join(format!("specs/{}/spec.md", status.slug)).is_file());
        assert!(!dir.join(format!("specs/{}/plan.md", status.slug)).exists());
        assert!(!dir.join(format!("specs/{}/tasks.md", status.slug)).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn approve_then_converge_loop() {
        let dir = scratch();
        let created = specify(&dir, "Compteur", "Incrémenter un compteur.").unwrap();
        let approved = approve(&dir, &created.slug).unwrap();
        assert_eq!(approved.phase, PHASE_IMPLEMENT);
        assert_eq!(approved.attempts, 1);
        assert!(dir
            .join(format!("specs/{}/plan.md", created.slug))
            .is_file());
        assert!(dir
            .join(format!("specs/{}/tasks.md", created.slug))
            .is_file());
        assert!(approve(&dir, &created.slug).is_err());

        assert_eq!(read_verdict(&dir, &created.slug).unwrap(), Verdict::Missing);
        let retry = apply_verdict(&approved, Verdict::Missing).unwrap();
        assert_eq!(retry.phase, PHASE_IMPLEMENT);
        assert_eq!(retry.attempts, 2);
        let retry = apply_verdict(&retry, Verdict::No).unwrap();
        assert_eq!(retry.attempts, 3);
        let failed = apply_verdict(&retry, Verdict::No).unwrap();
        assert_eq!(failed.phase, PHASE_FAILED);

        let created = specify(&dir, "Compteur deux", "Autre compteur.").unwrap();
        let approved = approve(&dir, &created.slug).unwrap();
        fs::write(
            dir.join(format!("specs/{}/convergence.md", created.slug)),
            "CONVERGED: yes\nTest ok.\n",
        )
        .unwrap();
        assert_eq!(read_verdict(&dir, &created.slug).unwrap(), Verdict::Yes);
        let done = apply_verdict(&approved, Verdict::Yes).unwrap();
        assert_eq!(done.phase, PHASE_CONVERGED);

        let created = specify(&dir, "Compteur trois", "Bloqué.").unwrap();
        let approved = approve(&dir, &created.slug).unwrap();
        let stopped = apply_verdict(&approved, Verdict::Fail).unwrap();
        assert_eq!(stopped.phase, PHASE_FAILED);
        assert_eq!(stopped.attempts, 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reject_blocks_code_phase() {
        let dir = scratch();
        let created = specify(&dir, "Brouillon", "Pas prêt.").unwrap();
        let rejected = reject(&dir, &created.slug, "à reformuler").unwrap();
        assert_eq!(rejected.phase, PHASE_REJECTED);
        assert!(approve(&dir, &created.slug).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
