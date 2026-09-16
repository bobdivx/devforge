//! Layout d’installation « logiciel » : binaire + `web/` + `templates/` + `data/` côte à côte.

use std::path::{Path, PathBuf};

/// Dossier qui contient l’exécutable (après résolution du symlink).
pub fn install_root() -> PathBuf {
    std::env::current_exe()
        .ok()
        .map(|p| std::fs::canonicalize(&p).unwrap_or(p))
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

pub fn is_packaged_app() -> bool {
    install_root().join("web").join("index.html").is_file()
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

/// Si le zip/installeur a posé `web/` à côté du binaire, on remplit les chemins
/// comme un vrai logiciel — sans variables d’environnement à coller.
/// Docker pose déjà ces vars : on ne les écrase pas.
pub fn apply_install_layout() {
    let root = install_root();
    if !is_packaged_app() {
        return;
    }

    let data = root.join("data");
    let _ = std::fs::create_dir_all(&data);
    set_if_unset("DEVFORGE_DATA_DIR", &data.to_string_lossy());
    set_if_unset("DATABASE_URL", &sqlite_url(&data.join("devforge.db")));
    set_if_unset(
        "DEVFORGE_STATIC_DIR",
        &root.join("web").to_string_lossy(),
    );

    let templates = root.join("templates");
    if templates.is_dir() {
        set_if_unset(
            "DEVFORGE_TEMPLATES_DIR",
            &templates.to_string_lossy(),
        );
    }
    set_if_unset("DEVFORGE_UPDATE_MODE", "binary");
    tracing::info!(root = %root.display(), "installation packagée (UI + data à côté du binaire)");
}

pub fn web_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("DEVFORGE_STATIC_DIR") {
        let p = PathBuf::from(&dir);
        if p.is_dir() {
            return Some(p);
        }
    }
    let beside = install_root().join("web");
    if beside.join("index.html").is_file() {
        return Some(beside);
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
    let beside = install_root().join("templates");
    if beside.is_dir() {
        return Some(beside);
    }
    None
}

/// Ouvre le navigateur une fois le serveur prêt (zip desktop, pas Docker).
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
