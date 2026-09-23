//! Layouts d’installation :
//! - assistant Windows / zip : `web/`, `templates/` et `data/` à côté de l’exécutable
//! - Flatpak : ressources dans `../share/devforge`, données dans le dossier XDG

use std::path::{Path, PathBuf};

/// Dossier qui contient l’exécutable (après résolution du symlink).
pub fn install_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// Dossier des fichiers livrés avec le programme (`web/`, `templates/`).
pub fn resource_root() -> PathBuf {
    let exe_dir = install_root();
    if exe_dir.join("web").join("index.html").is_file() {
        return exe_dir;
    }
    if let Some(parent) = exe_dir.parent() {
        let share = parent.join("share").join("devforge");
        if share.join("web").join("index.html").is_file() {
            return share;
        }
    }
    exe_dir
}

pub fn is_packaged_app() -> bool {
    resource_root().join("web").join("index.html").is_file()
}

fn is_share_layout(resources: &Path) -> bool {
    let name_ok = resources.file_name().and_then(|s| s.to_str()) == Some("devforge");
    let parent_ok = resources
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|s| s.to_str())
        == Some("share");
    name_ok && parent_ok
}

fn xdg_data_dir(xdg_data_home: Option<&str>, home: Option<&str>) -> Option<PathBuf> {
    if let Some(xdg) = xdg_data_home.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(PathBuf::from(xdg).join("devforge"));
    }
    if let Some(home) = home.map(str::trim).filter(|s| !s.is_empty()) {
        return Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("devforge"),
        );
    }
    None
}

fn packaged_data_dir(
    resources: &Path,
    exe_dir: &Path,
    flatpak: bool,
    xdg_data_home: Option<&str>,
    home: Option<&str>,
) -> PathBuf {
    if flatpak || is_share_layout(resources) {
        xdg_data_dir(xdg_data_home, home).unwrap_or_else(|| exe_dir.join("data"))
    } else {
        exe_dir.join("data")
    }
}

fn set_if_unset(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        // Process-local, before any threads that read env (startup only).
        unsafe { std::env::set_var(key, value) };
    }
}

fn sqlite_url(db_file: &Path) -> String {
    let s = db_file.to_string_lossy().replace('\\', "/");
    format!("sqlite:{s}?mode=rwc")
}

/// Installeur ou Flatpak : remplit les chemins sans variables à coller.
/// Docker pose déjà ces vars : on ne les écrase pas.
pub fn apply_install_layout() {
    let resources = resource_root();
    if !is_packaged_app() {
        return;
    }

    let flatpak = std::env::var_os("FLATPAK_ID").is_some();
    let xdg = std::env::var("XDG_DATA_HOME").ok();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok();
    let data = packaged_data_dir(
        &resources,
        &install_root(),
        flatpak,
        xdg.as_deref(),
        home.as_deref(),
    );
    let _ = std::fs::create_dir_all(&data);
    set_if_unset("DEVFORGE_DATA_DIR", &data.to_string_lossy());
    set_if_unset("DATABASE_URL", &sqlite_url(&data.join("devforge.db")));
    set_if_unset(
        "DEVFORGE_STATIC_DIR",
        &resources.join("web").to_string_lossy(),
    );

    let templates = resources.join("templates");
    if templates.is_dir() {
        set_if_unset("DEVFORGE_TEMPLATES_DIR", &templates.to_string_lossy());
    }
    set_if_unset("DEVFORGE_UPDATE_MODE", "binary");
    tracing::info!(
        resources = %resources.display(),
        data = %data.display(),
        flatpak,
        "installation packagée"
    );
}

pub fn web_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("DEVFORGE_STATIC_DIR") {
        let p = PathBuf::from(&dir);
        if p.is_dir() {
            return Some(p);
        }
    }
    let resources = resource_root().join("web");
    if resources.join("index.html").is_file() {
        return Some(resources);
    }
    None
}

pub fn templates_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("DEVFORGE_TEMPLATES_DIR") {
        let p = PathBuf::from(dir);
        if p.is_dir() {
            return Some(p);
        }
    }
    let templates = resource_root().join("templates");
    if templates.is_dir() {
        return Some(templates);
    }
    None
}

/// Ouvre le navigateur une fois le serveur prêt (installateur / Flatpak, pas Docker).
pub fn maybe_open_browser(url: &str) {
    if !is_packaged_app() {
        return;
    }
    if std::env::var_os("DEVFORGE_NO_BROWSER").is_some() {
        return;
    }
    if Path::new("/.dockerenv").exists() {
        return;
    }
    let url = url.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let r = {
            #[cfg(target_os = "windows")]
            {
                std::process::Command::new("cmd")
                    .args(["/C", "start", "", &url])
                    .spawn()
            }
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open").arg(&url).spawn()
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                std::process::Command::new("xdg-open").arg(&url).spawn()
            }
        };
        if let Err(e) = r {
            tracing::debug!(error = %e, "ouverture navigateur ignorée");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_layout_uses_xdg_data_home() {
        let resources = Path::new("/app/share/devforge");
        let exe = Path::new("/app/bin");
        let dir = packaged_data_dir(
            resources,
            exe,
            false,
            Some("/home/a/.var/app/id/data"),
            Some("/home/a"),
        );
        assert_eq!(dir, PathBuf::from("/home/a/.var/app/id/data/devforge"));
    }

    #[test]
    fn beside_exe_keeps_data_folder() {
        let resources = Path::new("/home/a/DevForge");
        let exe = Path::new("/home/a/DevForge");
        let dir = packaged_data_dir(resources, exe, false, None, Some("/home/a"));
        assert_eq!(dir, PathBuf::from("/home/a/DevForge/data"));
    }
}
