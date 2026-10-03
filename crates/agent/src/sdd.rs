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
    /// Nom affiché du fournisseur qui a fait le dernier tour (vide si aucun).
    #[serde(default)]
    pub provider: String,
    /// Retirée de la liste par l'utilisateur.
    #[serde(default)]
    pub dismissed: bool,
    /// Pourquoi la phase `failed` : empty, no_provider, no_feature, stopped, gave_up.
    #[serde(default)]
    pub blocker: String,
    pub updated_at: String,
}

pub const NOTE_IN_PROGRESS: &str = "En cours.";
pub const NOTE_NO_TOOL_PROVIDER: &str =
    "Ollama ne peut pas écrire cette fonctionnalité : il n'appelle pas les outils. Aucun autre modèle configuré n'est utilisable.";
pub const SKIP_OLLAMA: &str =
    "Ollama ne sait pas appeler les outils (la réponse est un JSON d'exemple). Les agents autonomes le mettent en tête ; la spec ne l'utilise pas.";
pub const NOTE_NO_FEATURE: &str =
    "Le modèle annonce que c'est fini, mais la fonctionnalité n'a pas été écrite.";
pub const NOTE_STOPPED: &str =
    "Le modèle s'est arrêté avant la fin. Tu peux réessayer ou retirer cette spec.";
pub const NOTE_GAVE_UP: &str = "Le modèle n'a pas réussi à terminer. Tu peux réessayer.";
pub const NOTE_READY: &str = "Prête à prévisualiser.";

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
        note: "En attente de ton accord.".into(),
        provider: String::new(),
        dismissed: false,
        blocker: String::new(),
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
    status.note = NOTE_IN_PROGRESS.into();
    status.blocker.clear();
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
    Ok(parse_verdict(&raw))
}

/// Nom lisible. `chain:Gemini>xAI` devient « Gemini, xAI ». `stub` disparaît.
pub fn provider_label_for_user(mode: &str) -> String {
    let s = mode.trim();
    let s = s.strip_prefix("chain:").unwrap_or(s).trim();
    if s.is_empty() || s.eq_ignore_ascii_case("stub") {
        return String::new();
    }
    s.replace('>', ", ")
}

pub fn empty_work_note(provider: &str) -> String {
    let label = provider_label_for_user(provider);
    if label.is_empty() {
        "Le modèle n'a pas fait le travail. La fonctionnalité n'a pas été écrite.".into()
    } else {
        format!("{label} n'a pas fait le travail. La fonctionnalité n'a pas été écrite.")
    }
}

/// `Some(raison)` si ce fournisseur ne doit pas exécuter SDD-IMPLEMENT.
/// Ollama (nom ou driver), y compris « Ollama NAS », est toujours écarté.
/// Tout autre modèle activé (Gemini, Demeter, xAI, …) peut appeler les outils.
pub fn spec_provider_skip_reason(
    name: &str,
    provider: &str,
    catalog_id: &str,
    enabled: bool,
) -> Option<&'static str> {
    if !enabled {
        return Some("désactivé");
    }
    let blob = format!("{name} {provider} {catalog_id}").to_ascii_lowercase();
    let driver = provider.trim().to_ascii_lowercase();
    if driver == "ollama" || blob.contains("ollama") {
        return Some(SKIP_OLLAMA);
    }
    None
}

pub fn provider_can_run_spec(name: &str, provider: &str, catalog_id: &str) -> bool {
    spec_provider_skip_reason(name, provider, catalog_id, true).is_none()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecProviderDecision {
    pub name: String,
    pub id: String,
}

/// Garde l'ordre de priorité. Le préféré des agents ne passe devant que s'il sait appeler les outils.
pub fn choose_spec_providers(
    rows: &[(&str, &str, &str, &str, bool)],
    preferred_id: &str,
) -> (Vec<SpecProviderDecision>, Vec<(String, String)>) {
    let mut used = Vec::new();
    let mut skipped = Vec::new();
    for (id, name, provider, catalog_id, enabled) in rows {
        if let Some(reason) = spec_provider_skip_reason(name, provider, catalog_id, *enabled) {
            skipped.push(((*name).to_string(), reason.to_string()));
            continue;
        }
        used.push(SpecProviderDecision {
            name: (*name).to_string(),
            id: (*id).to_string(),
        });
    }
    if !preferred_id.is_empty() {
        if let Some(pos) = used.iter().position(|row| row.id == preferred_id) {
            let row = used.remove(pos);
            used.insert(0, row);
        }
    }
    (used, skipped)
}

pub fn block_no_tool_provider(status: &FeatureStatus) -> FeatureStatus {
    let mut next = status.clone();
    next.phase = PHASE_FAILED.to_string();
    next.blocker = "no_provider".into();
    next.note = NOTE_NO_TOOL_PROVIDER.into();
    next.provider.clear();
    next.updated_at = now_stamp();
    next
}

fn normalize_rel(path: &str) -> String {
    let mut p = path.trim().replace('\\', "/");
    while let Some(rest) = p.strip_prefix("./") {
        p = rest.to_string();
    }
    p.trim_start_matches('/').to_ascii_lowercase()
}

fn is_feature_path(path: &str) -> bool {
    let p = normalize_rel(path);
    if p.is_empty() {
        return false;
    }
    if p == "readme.md" || p.ends_with("/readme.md") {
        return false;
    }
    if p == "license" || p == "license.md" || p == "license.txt" {
        return false;
    }
    if p == "specs" || p.starts_with("specs/") {
        return false;
    }
    if p.starts_with(".git/") {
        return false;
    }
    true
}

fn distinct_feature_paths(paths: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for path in paths {
        if !is_feature_path(path) {
            continue;
        }
        let norm = normalize_rel(path);
        if !out.contains(&norm) {
            out.push(norm);
        }
    }
    out
}

/// Un seul chemin, écrit au moins deux fois.
fn only_repeated_same_file(paths: &[String]) -> bool {
    if paths.len() < 2 {
        return false;
    }
    let mut uniq = Vec::new();
    for path in paths {
        let norm = normalize_rel(path);
        if !uniq.contains(&norm) {
            uniq.push(norm);
        }
    }
    uniq.len() == 1
}

/// La réponse n'est qu'un exemple de JSON d'outil, pas une phrase.
pub fn reply_is_example_tool_json(reply: &str) -> bool {
    let trimmed = reply.trim();
    if trimmed.is_empty() || !trimmed.contains('{') {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    let toolish = [
        "write_project_file",
        "read_project_file",
        "start_local_preview",
        "tool_calls",
        "\"name\"",
        "\"function\"",
    ]
    .iter()
    .any(|k| lower.contains(k));
    if !toolish {
        return false;
    }
    let prose = strip_jsonish(trimmed);
    prose.chars().filter(|c| c.is_alphabetic()).count() < 30
}

fn strip_jsonish(input: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    let mut fence = false;
    for line in input.lines() {
        let t = line.trim();
        if t.starts_with("```") {
            fence = !fence;
            continue;
        }
        if fence && depth == 0 && (t.starts_with('{') || t.starts_with('[')) {
            // toujours compté via les accolades
        }
        for c in line.chars() {
            if c == '{' || c == '[' {
                depth += 1;
            } else if c == '}' || c == ']' {
                depth = depth.saturating_sub(1);
            } else if depth == 0 {
                out.push(c);
            }
        }
        if depth == 0 {
            out.push('\n');
        }
    }
    out
}

pub fn write_paths_from_tools(raw: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(calls) = value.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for call in calls {
        let name = call.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name != "write_project_file" {
            continue;
        }
        let path = call
            .get("arguments")
            .and_then(|a| a.get("path"))
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .trim();
        if !path.is_empty() {
            out.push(path.to_string());
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnReport {
    pub reply: String,
    pub write_paths: Vec<String>,
    pub provider: String,
}

impl Default for TurnReport {
    fn default() -> Self {
        Self {
            reply: String::new(),
            write_paths: Vec::new(),
            provider: String::new(),
        }
    }
}

/// Un tour vide ne doit pas consommer les essais : JSON d'exemple, même fichier réécrit,
/// ou ni fichiers de la fonctionnalité ni vrai `CONVERGED:`.
pub fn implement_turn_is_empty(reply: &str, write_paths: &[String], verdict: Verdict) -> bool {
    let features = distinct_feature_paths(write_paths);
    let repeated = only_repeated_same_file(write_paths);
    if !features.is_empty() && !repeated {
        return false;
    }
    if repeated {
        return true;
    }
    if reply_is_example_tool_json(reply) && features.is_empty() {
        return true;
    }
    let real = matches!(verdict, Verdict::Yes | Verdict::No | Verdict::Fail);
    !real && features.is_empty()
}

pub fn apply_implement_turn(
    status: &FeatureStatus,
    verdict: Verdict,
    report: &TurnReport,
) -> Result<FeatureStatus, String> {
    if status.phase != PHASE_IMPLEMENT {
        return Err(format!(
            "convergence impossible : phase actuelle « {} »",
            status.phase
        ));
    }
    let mut next = status.clone();
    next.updated_at = now_stamp();
    let label = provider_label_for_user(&report.provider);
    if !label.is_empty() {
        next.provider = label;
    }
    let wrote = !distinct_feature_paths(&report.write_paths).is_empty()
        && !only_repeated_same_file(&report.write_paths);
    if implement_turn_is_empty(&report.reply, &report.write_paths, verdict) {
        next.phase = PHASE_FAILED.to_string();
        next.blocker = "empty".into();
        next.note = empty_work_note(&report.provider);
        return Ok(next);
    }
    match verdict {
        Verdict::Yes if wrote => {
            next.phase = PHASE_CONVERGED.to_string();
            next.blocker.clear();
            next.note = NOTE_READY.into();
        }
        Verdict::Yes => {
            next.phase = PHASE_FAILED.to_string();
            next.blocker = "no_feature".into();
            next.note = NOTE_NO_FEATURE.into();
        }
        Verdict::Fail => {
            next.phase = PHASE_FAILED.to_string();
            next.blocker = "stopped".into();
            next.note = NOTE_STOPPED.into();
        }
        Verdict::No | Verdict::Missing => {
            if status.attempts >= MAX_ATTEMPTS {
                next.phase = PHASE_FAILED.to_string();
                next.blocker = "gave_up".into();
                next.note = NOTE_GAVE_UP.into();
            } else {
                next.attempts = status.attempts.saturating_add(1);
                next.phase = PHASE_IMPLEMENT.to_string();
                next.blocker.clear();
                next.note = NOTE_IN_PROGRESS.into();
            }
        }
    }
    Ok(next)
}

/// Spec de contrôle laissée par un essai interne : pas une fonctionnalité de l'utilisateur.
pub fn is_internal_control(status: &FeatureStatus) -> bool {
    let slug = status.slug.to_lowercase();
    let title = status.title.to_lowercase();
    let note = status.note.to_lowercase();
    slug.contains("verification-boucle")
        || title.contains("vérification boucle")
        || title.contains("verification boucle")
        || note.contains("spec de contrôle")
        || note.contains("spec de controle")
        || note.contains("ne pas rester en attente")
}

pub fn dismiss(workdir: &Path, slug: &str) -> Result<FeatureStatus, String> {
    let Some(mut status) = read_status(workdir, slug)? else {
        return Err("spec introuvable".into());
    };
    if status.phase != PHASE_FAILED && status.phase != PHASE_REJECTED {
        return Err("seule une spec échouée ou refusée peut être retirée".into());
    }
    status.dismissed = true;
    status.updated_at = now_stamp();
    write_status(workdir, &status)?;
    Ok(status)
}

pub fn reopen_for_retry(workdir: &Path, slug: &str) -> Result<FeatureStatus, String> {
    let Some(mut status) = read_status(workdir, slug)? else {
        return Err("spec introuvable".into());
    };
    if status.dismissed {
        return Err("spec retirée".into());
    }
    if status.phase != PHASE_FAILED {
        return Err(format!(
            "nouvel essai impossible : phase actuelle « {} »",
            status.phase
        ));
    }
    status.phase = PHASE_IMPLEMENT.to_string();
    status.attempts = 1;
    status.blocker.clear();
    status.provider.clear();
    status.note = NOTE_IN_PROGRESS.into();
    status.updated_at = now_stamp();
    write_status(workdir, &status)?;
    Ok(status)
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
            if status.dismissed || is_internal_control(&status) {
                continue;
            }
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

Tu implémentes la fonctionnalité « {title} ».
Appelle les outils. N'écris jamais leur JSON dans le message.
1. read_project_file sur specs/constitution.md, specs/{slug}/spec.md, specs/{slug}/plan.md et specs/{slug}/tasks.md.
2. write_project_file (mode=local) pour les fichiers de la fonctionnalité. Pas seulement README.md. Chaque fichier une seule fois, avec le vrai contenu.
3. start_local_preview quand ces fichiers sont en place.
4. write_project_file specs/{slug}/convergence.md. La première ligne est exactement `CONVERGED: yes` si la fonctionnalité est écrite, `CONVERGED: no` s'il reste un écart, ou `CONVERGED: fail` si un blocage empêche de continuer. La suite dit pourquoi, en français.
Interdit : dépôt, pull request, publication, déploiement.
",
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
        let feature = TurnReport {
            reply: "Page écrite.".into(),
            write_paths: vec!["src/pages/index.astro".into()],
            provider: "Gemini".into(),
        };
        let retry = apply_implement_turn(&approved, Verdict::No, &feature).unwrap();
        assert_eq!(retry.phase, PHASE_IMPLEMENT);
        assert_eq!(retry.attempts, 2);
        assert!(!retry.note.contains("essai"));
        let retry = apply_implement_turn(&retry, Verdict::No, &feature).unwrap();
        assert_eq!(retry.attempts, 3);
        let failed = apply_implement_turn(&retry, Verdict::No, &feature).unwrap();
        assert_eq!(failed.phase, PHASE_FAILED);
        assert_eq!(failed.blocker, "gave_up");
        assert!(!failed.note.contains("convergence.md"));

        let created = specify(&dir, "Compteur deux", "Autre compteur.").unwrap();
        let approved = approve(&dir, &created.slug).unwrap();
        fs::write(
            dir.join(format!("specs/{}/convergence.md", created.slug)),
            "CONVERGED: yes\nTest ok.\n",
        )
        .unwrap();
        assert_eq!(read_verdict(&dir, &created.slug).unwrap(), Verdict::Yes);
        let done = apply_implement_turn(
            &approved,
            Verdict::Yes,
            &TurnReport {
                reply: "Fait.".into(),
                write_paths: vec!["src/pages/index.astro".into()],
                provider: "Gemini".into(),
            },
        )
        .unwrap();
        assert_eq!(done.phase, PHASE_CONVERGED);
        assert_eq!(done.note, NOTE_READY);

        let created = specify(&dir, "Compteur trois", "Bloqué.").unwrap();
        let approved = approve(&dir, &created.slug).unwrap();
        let stopped = apply_implement_turn(
            &approved,
            Verdict::Fail,
            &TurnReport {
                reply: "Bloqué.".into(),
                write_paths: vec!["src/pages/index.astro".into()],
                provider: "Gemini".into(),
            },
        )
        .unwrap();
        assert_eq!(stopped.phase, PHASE_FAILED);
        assert_eq!(stopped.attempts, 1);
        assert_eq!(stopped.blocker, "stopped");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_retry_stops_without_burning_attempts() {
        let dir = scratch();
        let created = specify(&dir, "Template", "Une page.").unwrap();
        let approved = approve(&dir, &created.slug).unwrap();
        assert_eq!(approved.attempts, 1);
        let dump = r#"{"name":"write_project_file","arguments":{"path":"README.md","content":"exemple"}}"#;
        let report = TurnReport {
            reply: dump.into(),
            write_paths: vec!["README.md".into(), "README.md".into()],
            provider: "Ollama NAS".into(),
        };
        assert!(implement_turn_is_empty(&report.reply, &report.write_paths, Verdict::Missing));
        let stopped = apply_implement_turn(&approved, Verdict::Missing, &report).unwrap();
        assert_eq!(stopped.phase, PHASE_FAILED);
        assert_eq!(stopped.attempts, 1, "un tour vide ne consomme pas les essais");
        assert_eq!(stopped.blocker, "empty");
        assert!(stopped.note.contains("Ollama NAS"));
        assert!(stopped.note.contains("n'a pas fait le travail"));
        assert!(!stopped.note.contains("convergence.md"));
        assert!(!stopped.note.contains("essai"));
        assert!(apply_implement_turn(&stopped, Verdict::Missing, &report).is_err());

        let announced = apply_implement_turn(
            &approved,
            Verdict::Yes,
            &TurnReport {
                reply: "C'est terminé.".into(),
                write_paths: vec!["README.md".into()],
                provider: "Gemini".into(),
            },
        )
        .unwrap();
        assert_eq!(announced.phase, PHASE_FAILED);
        assert_eq!(announced.blocker, "no_feature");
        assert_eq!(announced.attempts, 1);
        assert!(!announced.note.contains("convergence.md"));

        let real = TurnReport {
            reply: "J'ai écrit la page.".into(),
            write_paths: vec!["src/pages/index.astro".into()],
            provider: "Gemini".into(),
        };
        assert!(!implement_turn_is_empty(&real.reply, &real.write_paths, Verdict::Missing));
        let again = apply_implement_turn(&approved, Verdict::Missing, &real).unwrap();
        assert_eq!(again.phase, PHASE_IMPLEMENT);
        assert_eq!(again.attempts, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn spec_worker_skips_ollama_nas_and_keeps_configured_models() {
        // id, name, driver, catalog, enabled — priorité déjà appliquée.
        let rows = [
            ("ollama", "Ollama NAS", "ollama", "ollama", true),
            ("gem", "Gemini", "gemini", "gemini", true),
            ("dem", "Demeter", "openai", "custom", true),
            ("x", "xAI", "xai", "xai", true),
            ("old", "Ancien", "openai", "openai", false),
        ];
        let (used, skipped) = choose_spec_providers(&rows, "ollama");
        assert_eq!(
            used.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
            vec!["Gemini", "Demeter", "xAI"]
        );
        assert!(skipped.iter().any(|(name, reason)| {
            name == "Ollama NAS" && reason.contains("ne sait pas appeler les outils")
        }));
        assert!(skipped.iter().any(|(name, reason)| name == "Ancien" && reason == "désactivé"));
        let (used, _) = choose_spec_providers(&rows, "dem");
        assert_eq!(used[0].name, "Demeter");
        assert!(provider_label_for_user("stub").is_empty());
    }

    #[test]
    fn control_spec_and_dismiss_leave_the_list() {
        let dir = scratch();
        let control = specify(&dir, "Vérification boucle spec", "Contrôle.").unwrap();
        let rejected = reject(
            &dir,
            &control.slug,
            "Spec de contrôle, rejetée pour ne pas rester en attente.",
        )
        .unwrap();
        assert!(is_internal_control(&rejected));
        assert!(list_features(&dir).unwrap().is_empty());

        let user = specify(&dir, "Page d'accueil", "Un titre.").unwrap();
        let mut failed = approve(&dir, &user.slug).unwrap();
        failed.phase = PHASE_FAILED.to_string();
        failed.blocker = "empty".into();
        failed.note = empty_work_note("Gemini");
        write_status(&dir, &failed).unwrap();
        assert_eq!(list_features(&dir).unwrap().len(), 1);
        dismiss(&dir, &user.slug).unwrap();
        assert!(list_features(&dir).unwrap().is_empty());
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
