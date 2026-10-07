use super::*;
use std::path::{Path, PathBuf};
use std::process::Command;

fn sh(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).to_string()
}

struct Fx {
    root: PathBuf,
    remote: PathBuf,
    wd: PathBuf,
}

impl Drop for Fx {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn fixture(name: &str) -> Fx {
    let root = std::env::temp_dir().join(format!("df-draft-{name}-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let remote = root.join("remote.git");
    let seed = root.join("seed");
    let wd = root.join("wd");
    sh(&root, &["init", "--bare", "-q", remote.to_str().unwrap()]);
    sh(&root, &["init", "-q", seed.to_str().unwrap()]);
    std::fs::create_dir_all(seed.join("src")).unwrap();
    std::fs::write(seed.join("package-lock.json"), "{}\n").unwrap();
    std::fs::write(seed.join("src/routeTree.gen.ts"), "export {}\n").unwrap();
    std::fs::write(seed.join("README.md"), "hello\n").unwrap();
    std::fs::write(seed.join(".gitignore"), "node_modules/\n").unwrap();
    sh(&seed, &["add", "-A"]);
    sh(&seed, &["commit", "-qm", "init"]);
    sh(&seed, &["branch", "-M", "main"]);
    sh(&seed, &["push", "-q", remote.to_str().unwrap(), "main"]);
    sh(&root, &["clone", "-q", "-b", "main", remote.to_str().unwrap(), wd.to_str().unwrap()]);
    Fx { root, remote, wd }
}

fn paths(st: &DraftStatus) -> Vec<(String, String)> {
    st.files.iter().map(|f| (f.path.clone(), f.status.clone())).collect()
}

#[test]
fn junk_rules() {
    for j in [
        ".devforge-npm-stamp",
        ".devforge-preview.log",
        ".devforge.json",
        ".devforge-smoke/out.png",
        "sub/.devforge-preview.pid",
        "node_modules/x/index.js",
        "dist/index.html",
        ".env",
        ".env.local",
        "npm-debug.log",
        ".DS_Store",
    ] {
        assert!(is_junk(j), "{j} devrait être ignoré");
    }
    for ok in ["src/app.tsx", "package-lock.json", ".env.example", "public/og-image.png", "docs/build.md"] {
        assert!(!is_junk(ok), "{ok} ne devrait pas être ignoré");
    }
}

#[test]
fn porcelain_keeps_first_character_and_skips_internals() {
    // Régression : la 1re ligne commençait par un espace, perdu par un trim → « ackage-lock.json ».
    let raw = " M package-lock.json\n M src/routeTree.gen.ts\n?? .devforge-npm-stamp\n?? .devforge-smoke/\nR  old.ts -> new.ts\n?? \"with space.txt\"\n";
    let got = crate::git_routes::parse_porcelain(raw);
    assert_eq!(
        got,
        vec![
            ("M".to_string(), "package-lock.json".to_string()),
            ("M".to_string(), "src/routeTree.gen.ts".to_string()),
            ("R".to_string(), "new.ts".to_string()),
            ("??".to_string(), "with space.txt".to_string()),
        ]
    );
}

#[test]
fn status_lists_full_paths_and_ignores_junk() {
    let fx = fixture("status");
    std::fs::write(fx.wd.join("package-lock.json"), "{\"a\":1}\n").unwrap();
    std::fs::write(fx.wd.join("src/routeTree.gen.ts"), "export const x = 1\n").unwrap();
    std::fs::remove_file(fx.wd.join("README.md")).unwrap();
    std::fs::write(fx.wd.join("src/new.ts"), "new\n").unwrap();
    std::fs::write(fx.wd.join(".devforge-npm-stamp"), "x").unwrap();
    std::fs::write(fx.wd.join(".devforge.json"), "{}").unwrap();
    std::fs::create_dir_all(fx.wd.join(".devforge-smoke")).unwrap();
    std::fs::write(fx.wd.join(".devforge-smoke/a.png"), "x").unwrap();
    let st = status(&fx.wd, "main", None);
    assert!(st.available && st.dirty);
    assert_eq!(
        paths(&st),
        vec![
            ("README.md".into(), "deleted".into()),
            ("package-lock.json".into(), "modified".into()),
            ("src/new.ts".into(), "added".into()),
            ("src/routeTree.gen.ts".into(), "modified".into()),
        ]
    );
    // Les fichiers internes sont aussi ajoutés à `.git/info/exclude` : plus jamais listés.
    let excl = std::fs::read_to_string(fx.wd.join(".git/info/exclude")).unwrap();
    assert!(excl.contains(".devforge-*") && excl.contains(".devforge.*"));
    assert_eq!((st.ahead, st.behind), (0, 0));
    assert!(st.updated_at.is_some());
}

#[test]
fn only_junk_is_not_a_draft() {
    let fx = fixture("junk");
    std::fs::write(fx.wd.join(".devforge-npm-stamp"), "x").unwrap();
    std::fs::write(fx.wd.join(".devforge-preview.log"), "x").unwrap();
    let st = status(&fx.wd, "main", None);
    assert!(!st.dirty);
    assert!(st.files.is_empty());
}

#[test]
fn diff_includes_untracked_files_as_added() {
    let fx = fixture("diff");
    std::fs::write(fx.wd.join("src/new.ts"), "line1\nline2\n").unwrap();
    std::fs::write(fx.wd.join("README.md"), "hello\nworld\n").unwrap();
    let files = diff(&fx.wd, "main", None).unwrap();
    let new = files.iter().find(|f| f["path"] == "src/new.ts").expect("nouveau fichier présent");
    assert_eq!(new["status"], "added");
    assert_eq!(new["additions"], 2);
    assert!(new["patch"].as_str().unwrap().contains("+line2"));
    let readme = files.iter().find(|f| f["path"] == "README.md").unwrap();
    assert_eq!(readme["additions"], 1);
    assert!(diff(&fx.wd, "main", Some("nope.txt")).is_err());
}

#[test]
fn validate_pushes_text_and_binary_but_not_junk() {
    let fx = fixture("validate");
    let png = vec![0x89u8, b'P', b'N', b'G', 0, 1, 2, 0xff];
    std::fs::create_dir_all(fx.wd.join("public")).unwrap();
    std::fs::write(fx.wd.join("public/og-image.png"), &png).unwrap();
    std::fs::write(fx.wd.join("README.md"), "hello v2\n").unwrap();
    std::fs::write(fx.wd.join(".devforge-npm-stamp"), "x").unwrap();
    std::fs::write(fx.wd.join(".env"), "SECRET=1").unwrap();
    let url = fx.remote.to_str().unwrap().to_string();
    let v = validate(&fx.wd, "main", &url, "feat: og image", ("Mathieu", "m@x")).unwrap();
    assert_eq!(v.files, 2);
    let tree = sh(&fx.remote, &["ls-tree", "-r", "--name-only", "main"]);
    assert!(tree.contains("public/og-image.png"));
    assert!(!tree.contains(".devforge-npm-stamp") && !tree.contains(".env"));
    let blob = Command::new("git").arg("-C").arg(&fx.remote).args(["show", "main:public/og-image.png"]).output().unwrap();
    assert_eq!(blob.stdout, png);
    let log = sh(&fx.remote, &["log", "-1", "--format=%an|%s", "main"]);
    assert_eq!(log.trim(), "Mathieu|feat: og image");
    let st = status(&fx.wd, "main", None);
    assert!(!st.dirty);
    let excl = std::fs::read_to_string(fx.wd.join(".git/info/exclude")).unwrap();
    assert!(excl.contains(".devforge-*") && excl.contains(".devforge.*"));
    // Rien à valider ensuite.
    assert!(validate(&fx.wd, "main", &url, "x", ("a", "b")).is_err());
    assert!(validate(&fx.wd, "main", &url, "  ", ("a", "b")).is_err());
}

#[test]
fn validate_refuses_when_github_moved() {
    let fx = fixture("behind");
    let other = fx.root.join("other");
    sh(&fx.root, &["clone", "-q", fx.remote.to_str().unwrap(), other.to_str().unwrap()]);
    std::fs::write(other.join("CHANGELOG.md"), "x\n").unwrap();
    sh(&other, &["add", "-A"]);
    sh(&other, &["commit", "-qm", "remote change"]);
    sh(&other, &["push", "-q", "origin", "main"]);
    std::fs::write(fx.wd.join("README.md"), "local\n").unwrap();
    let url = fx.remote.to_str().unwrap().to_string();
    let e = validate(&fx.wd, "main", &url, "local", ("a", "b")).unwrap_err();
    assert!(e.0.contains("Mets d'abord à jour"), "{}", e.0);
    // Mise à jour sans conflit (fichiers différents), le brouillon reste.
    let u = update_from_github(&fx.wd, "main", Some(&url), ("a", "b")).unwrap();
    assert_eq!(u.merged, 1);
    assert!(fx.wd.join("CHANGELOG.md").is_file());
    assert_eq!(std::fs::read_to_string(fx.wd.join("README.md")).unwrap(), "local\n");
    assert!(validate(&fx.wd, "main", &url, "local", ("a", "b")).is_ok());
}

#[test]
fn update_refuses_on_overlap() {
    let fx = fixture("overlap");
    let other = fx.root.join("other");
    sh(&fx.root, &["clone", "-q", fx.remote.to_str().unwrap(), other.to_str().unwrap()]);
    std::fs::write(other.join("README.md"), "remote\n").unwrap();
    sh(&other, &["commit", "-qam", "remote readme"]);
    sh(&other, &["push", "-q", "origin", "main"]);
    std::fs::write(fx.wd.join("README.md"), "local\n").unwrap();
    let url = fx.remote.to_str().unwrap().to_string();
    let e = update_from_github(&fx.wd, "main", Some(&url), ("a", "b")).unwrap_err();
    assert!(e.0.contains("README.md"), "{}", e.0);
    assert_eq!(std::fs::read_to_string(fx.wd.join("README.md")).unwrap(), "local\n");
}

#[test]
fn discard_backs_up_keeps_deps_and_restores() {
    let fx = fixture("discard");
    let backups = fx.root.join("backups");
    std::fs::write(fx.wd.join("README.md"), "changed\n").unwrap();
    std::fs::write(fx.wd.join("src/new.ts"), "new\n").unwrap();
    std::fs::remove_file(fx.wd.join("package-lock.json")).unwrap();
    std::fs::create_dir_all(fx.wd.join("node_modules/x")).unwrap();
    std::fs::write(fx.wd.join("node_modules/x/i.js"), "dep").unwrap();
    std::fs::write(fx.wd.join(".devforge-npm-stamp"), "x").unwrap();
    let st = status(&fx.wd, "main", None);
    let b = backup(&fx.wd, &backups, &st.files, "discard").unwrap();
    discard(&fx.wd, "main", None).unwrap();
    assert!(!status(&fx.wd, "main", None).dirty);
    assert_eq!(std::fs::read_to_string(fx.wd.join("README.md")).unwrap(), "hello\n");
    assert!(!fx.wd.join("src/new.ts").exists());
    assert!(fx.wd.join("package-lock.json").is_file());
    assert!(fx.wd.join("node_modules/x/i.js").is_file(), "dépendances gardées");
    assert!(fx.wd.join(".devforge-npm-stamp").is_file(), "fichiers internes gardés");
    assert_eq!(list_backups(&backups).len(), 1);
    restore(&fx.wd, &backups, &b.id).unwrap();
    let back = status(&fx.wd, "main", None);
    assert_eq!(paths(&back), paths(&st));
    assert_eq!(std::fs::read_to_string(fx.wd.join("README.md")).unwrap(), "changed\n");
    assert!(list_backups(&backups).is_empty(), "sauvegarde consommée");
    assert!(restore(&fx.wd, &backups, "../etc").is_err());
}

#[test]
fn old_backups_expire() {
    let fx = fixture("expire");
    let backups = fx.root.join("backups");
    std::fs::write(fx.wd.join("README.md"), "changed\n").unwrap();
    let st = status(&fx.wd, "main", None);
    let b = backup(&fx.wd, &backups, &st.files, "discard").unwrap();
    let mut old = b.clone();
    old.created_at = (chrono::Utc::now() - chrono::Duration::days(8)).to_rfc3339();
    std::fs::write(backups.join(&b.id).join("manifest.json"), serde_json::to_vec(&old).unwrap()).unwrap();
    assert!(list_backups(&backups).is_empty());
    assert!(!backups.join(&b.id).exists());
}

#[test]
fn revert_single_file() {
    let fx = fixture("revert");
    std::fs::write(fx.wd.join("README.md"), "changed\n").unwrap();
    std::fs::write(fx.wd.join("src/new.ts"), "new\n").unwrap();
    let st = status(&fx.wd, "main", None);
    let readme = st.files.iter().find(|f| f.path == "README.md").unwrap().clone();
    let new = st.files.iter().find(|f| f.path == "src/new.ts").unwrap().clone();
    revert_file(&fx.wd, "main", &readme).unwrap();
    assert_eq!(std::fs::read_to_string(fx.wd.join("README.md")).unwrap(), "hello\n");
    revert_file(&fx.wd, "main", &new).unwrap();
    assert!(!fx.wd.join("src/new.ts").exists());
    assert!(!status(&fx.wd, "main", None).dirty);
    let bad = DraftFile { path: "../x".into(), status: "added".into(), old_path: None };
    assert!(revert_file(&fx.wd, "main", &bad).is_err());
}

#[test]
fn tokens_never_leak() {
    let u = token_url("bobdivx/devforge", Some("ghp_secret"));
    assert_eq!(u, "https://x-access-token:ghp_secret@github.com/bobdivx/devforge.git");
    assert_eq!(token_url("https://github.com/a/b.git", None), "https://github.com/a/b.git");
    let msg = format!("fatal: unable to access '{u}': 403");
    let r = redact(&msg);
    assert!(!r.contains("ghp_secret"), "{r}");
    assert!(r.contains("https://***@github.com/bobdivx/devforge.git"));
}

#[test]
fn suggested_message_from_files() {
    let f = |p: &str, s: &str| DraftFile { path: p.into(), status: s.into(), old_path: None };
    assert_eq!(suggested_message(&[f("src/a.ts", "added")]), "feat: ajoute a.ts");
    assert_eq!(
        suggested_message(&[f("a", "modified"), f("b", "added"), f("c", "deleted"), f("d", "modified")]),
        "feat: met à jour a, b, c (+1)"
    );
    assert_eq!(suggested_message(&[]), "");
}
