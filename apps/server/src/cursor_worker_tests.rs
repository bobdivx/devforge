use super::*;

#[test]
fn build_args_multi_dirs_without_key() {
    let args = build_worker_args(
        "demeter",
        &[
            "/data/devforge/applications/a".into(),
            "/data/devforge/applications/b".into(),
        ],
    )
    .unwrap();
    assert_eq!(args[0], "worker");
    assert!(args.contains(&"--name".into()));
    assert!(args.contains(&"demeter".into()));
    let dir_flags = args.iter().filter(|a| *a == "--worker-dir").count();
    assert_eq!(dir_flags, 2);
    assert_eq!(args.last().unwrap(), "start");
    assert!(args.contains(&MANAGEMENT_ADDR.to_string()));
    // La clé ne passe jamais en argument (visible dans `ps`).
    assert!(!args.iter().any(|a| a == "--api-key"));
}

#[test]
fn build_args_caps_worker_dirs() {
    let dirs: Vec<String> = (0..30).map(|i| format!("/r/{i}")).collect();
    let args = build_worker_args("x", &dirs).unwrap();
    let n = args.iter().filter(|a| *a == "--worker-dir").count();
    assert_eq!(n, MAX_WORKER_DIRS);
}

#[test]
fn build_args_rejects_empty() {
    assert!(build_worker_args("x", &[]).is_err());
}

#[test]
fn parse_extra_dirs_mixed() {
    let v = parse_extra_dirs("/a\n# comment\n/b, /c ; /d");
    assert_eq!(v, vec!["/a", "/b", "/c", "/d"]);
}

#[test]
fn mask_key_short_and_long() {
    assert_eq!(mask_key(""), "");
    assert_eq!(mask_key("abcd"), "••••");
    let m = mask_key("abcdefghijklmnop");
    assert!(m.starts_with("abcd"));
    assert!(m.ends_with("mnop"));
}

#[test]
fn slug_and_default_name() {
    assert_eq!(slug_name("ZimaCube (NAS)"), "zimacube-nas");
    assert_eq!(slug_name("  demeter  "), "demeter");
    assert_eq!(slug_name("Ce serveur"), "ce-serveur");
    let mut s = WorkerSettings::default();
    assert_eq!(resolve_worker_name_for_node(&s, "ZimaCube"), "zimacube");
    s.name = "perso".into();
    assert_eq!(resolve_worker_name_for_node(&s, "ZimaCube"), "perso");
}

#[test]
fn validate_api_key_rules() {
    assert!(validate_api_key("").is_err());
    assert!(validate_api_key("short").is_err());
    assert!(validate_api_key("key_abc def ghi jkl mno").is_err());
    assert_eq!(
        validate_api_key("  key_0123456789abcdef  ").unwrap(),
        "key_0123456789abcdef"
    );
}

#[test]
fn leader_target() {
    assert!(is_leader_target(""));
    assert!(is_leader_target("default"));
    assert!(!is_leader_target("node-1"));
}

#[test]
fn shell_quote_escapes() {
    assert_eq!(shell_quote("a b"), "'a b'");
    assert_eq!(shell_quote("it's"), "'it'\\''s'");
}

#[test]
fn scripts_never_print_key_and_use_env() {
    let key = "key_SECRET_0123456789";
    let s = start_script(
        &ScriptBase::NodeDataDir,
        "demeter",
        &[("/data/applications/a".into(), "main".into())],
        &[],
        key,
    );
    assert!(s.contains("K='key_SECRET_0123456789'"));
    assert!(s.contains("CURSOR_API_KEY=\"$K\""));
    assert!(!s.contains("--api-key"));
    // La clé n'apparaît qu'une fois (affectation), jamais dans un echo.
    assert_eq!(s.matches(key).count(), 1);
    assert!(!s.lines().any(|l| l.contains("echo") && l.contains(key)));
    assert!(s.contains("${DEVFORGE_DATA_DIR:-/data}/cursor-worker"));
    assert!(s.contains("--management-addr"));
    assert!(s.contains("setsid"));
    assert!(s.contains("</dev/null"));
}

#[test]
fn install_script_targets_managed_home() {
    let s = install_script(&ScriptBase::Literal("/data/cursor-worker".into()));
    assert!(s.starts_with("D='/data/cursor-worker'"));
    assert!(s.contains("export HOME=\"$D/home\""));
    assert!(s.contains(INSTALL_URL));
    assert!(s.contains("DF_AGENT="));
}

#[test]
fn parse_output_reads_markers_and_logs() {
    let out = "DF_AGENT=/data/cursor-worker/home/.local/bin/agent\nDF_VERSION=2026.10.1\nDF_DIR=/data/applications/a\nDF_DIR=/data/applications/b\nDF_RUNNING=1\nDF_PID=4242\nDF_READY=1\nDF_LOGS_BEGIN\nconnected\nDF_RUNNING=0\n";
    let r = parse_script_output(out);
    assert_eq!(
        r.agent.as_deref(),
        Some("/data/cursor-worker/home/.local/bin/agent")
    );
    assert_eq!(r.version.as_deref(), Some("2026.10.1"));
    assert_eq!(r.dirs.len(), 2);
    assert!(r.running);
    assert_eq!(r.pid, Some(4242));
    assert_eq!(r.ready, Some(true));
    // Après DF_LOGS_BEGIN, tout est log (pas réinterprété).
    assert!(r.logs.contains("connected"));
    assert!(r.logs.contains("DF_RUNNING=0"));
}

#[test]
fn hint_never_asks_for_a_command() {
    for (cli, key, run, ready) in [
        (false, false, false, None),
        (false, true, false, None),
        (true, true, false, None),
        (true, true, true, Some(false)),
        (true, true, true, Some(true)),
    ] {
        let h = status_hint(cli, key, run, ready);
        assert!(!h.contains("curl"), "{h}");
        assert!(!h.contains("| bash"), "{h}");
    }
}

/// Exécute réellement les scripts (sh) avec un faux `agent` : installation
/// sautée (CLI présent), démarrage, statut, arrêt.
#[cfg(target_os = "linux")]
#[test]
fn scripts_run_end_to_end_with_fake_agent() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = std::env::temp_dir().join(format!("cw-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let base_dir = tmp.join("cursor-worker");
    let bin_dir = base_dir.join("home/.local/bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    let fake = bin_dir.join("agent");
    std::fs::write(
        &fake,
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 9.9.9; exit 0; fi\n[ -n \"$CURSOR_API_KEY\" ] || { echo nokey >&2; exit 1; }\necho \"args: $*\"\nexec sleep 30\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let repo = tmp.join("repo a");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    let repo_b = tmp.join("repo-b");
    std::fs::create_dir_all(&repo_b).unwrap();
    // Vrai dépôt (avec un commit) : servi via son worktree `-cursor`, le nom
    // de machine vient du remote `origin`.
    let g = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(&repo_b)
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    let git_ok = g(&["init", "-q", "-b", "main"])
        && g(&[
            "remote",
            "add",
            "origin",
            "https://github.com/o/Template-Studio.git",
        ])
        && g(&["commit", "-q", "--allow-empty", "-m", "init"]);
    if !git_ok {
        return; // git absent : le reste est couvert par les autres tests.
    }
    let wt_b = format!("{}-cursor", repo_b.display());
    let base = ScriptBase::Literal(base_dir.display().to_string());

    let run = |script: &str| {
        std::process::Command::new("sh")
            .arg("-c")
            .arg(script)
            .output()
            .unwrap()
    };

    let out = run(&install_script(&base));
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let r = parse_script_output(&String::from_utf8_lossy(&out.stdout));
    assert_eq!(r.version.as_deref(), Some("9.9.9"));

    let out = run(&start_script(
        &base,
        "demo",
        &[
            ("/nope".into(), "main".into()),
            (repo_b.display().to_string(), "main".into()),
        ],
        &[repo.display().to_string()],
        "key_0123456789abcdef",
    ));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}");
    let r = parse_script_output(&stdout);
    assert!(r.running);
    // Le projet est servi depuis son worktree, jamais depuis le checkout.
    assert_eq!(r.dirs, vec![wt_b.clone(), repo.display().to_string()]);
    assert!(r.worktree_errors.is_empty(), "{stdout}");
    assert!(Path::new(&wt_b).join(".git").exists());
    let head = std::process::Command::new("git")
        .arg("-C")
        .arg(&wt_b)
        .args(["symbolic-ref", "--short", "HEAD"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), CURSOR_BRANCH);
    // Un process par dépôt : le principal sert UNIQUEMENT le premier dossier.
    assert_eq!(r.repos_up, Some(2));
    let log = std::fs::read_to_string(base_dir.join("worker.out")).unwrap();
    // Un nom de machine par dépôt (sinon tous partagent le même workerId).
    assert!(log.contains("--name demo-template-studio "), "{log}");
    assert_eq!(
        r.names,
        vec![
            "demo-template-studio".to_string(),
            "demo-repo-a".to_string()
        ]
    );
    assert!(log.contains(&format!("--worker-dir {wt_b} ")), "{log}");
    assert!(log.contains("--management-addr"));
    assert!(!log.contains("key_0123456789abcdef"));
    let log_b = std::fs::read_to_string(base_dir.join("repos/1/worker.out")).unwrap();
    assert!(log_b.contains("--name demo-repo-a "), "{log_b}");
    assert!(log_b.contains(&format!("--worker-dir {}", repo.display())));
    assert!(log_b.contains("--data-dir"));
    assert!(!log_b.contains("--management-addr"));
    assert!(!log_b.contains("repo-b"));
    let pid_b: u32 = std::fs::read_to_string(base_dir.join("repos/1/worker.pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();

    let out = run(&status_script(&base));
    let r = parse_script_output(&String::from_utf8_lossy(&out.stdout));
    assert!(r.running);
    assert_eq!(r.repos_up, Some(2));
    assert_eq!(r.version.as_deref(), Some("9.9.9"));

    let out = run(&stop_script(&base));
    let r = parse_script_output(&String::from_utf8_lossy(&out.stdout));
    assert!(!r.running);
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(!pid_is_alive(pid_b), "worker du 2e dépôt toujours vivant");
    assert!(!base_dir.join("repos/1/worker.pid").exists());
    let out = run(&status_script(&base));
    assert!(!parse_script_output(&String::from_utf8_lossy(&out.stdout)).running);
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn rejects_keys_from_other_providers() {
    let e = validate_api_key("xai-0123456789abcdefghijklmnop").unwrap_err();
    assert!(e.contains("xAI"), "{e}");
    assert!(e.contains("cursor.com/dashboard"), "{e}");
    assert_eq!(
        foreign_key_provider("sk-ant-api03-xxxxxxxxxxxx"),
        Some("Anthropic")
    );
    assert_eq!(
        foreign_key_provider("sk-proj-xxxxxxxxxxxxxxxx"),
        Some("OpenAI")
    );
    assert_eq!(foreign_key_provider("key_0123456789abcdef"), None);
    assert!(validate_api_key("key_0123456789abcdef").is_ok());
}

#[test]
fn detects_invalid_key_in_worker_logs() {
    let logs = "—— worker.err ——\n\u{1b}[33m⚠ Warning: The provided API key is invalid.\u{1b}[0m\nThe API key was loaded from the CURSOR_API_KEY environment variable.";
    assert!(logs_show_invalid_key(logs));
    assert!(!logs_show_invalid_key("Starting worker...\nconnected"));
    assert!(!logs_show_invalid_key(""));
}

#[test]
fn invalid_key_hint_points_to_cursor_dashboard() {
    assert!(INVALID_KEY_HINT.contains("Se connecter avec Cursor"));
    assert!(GROK_KEY_HINT.contains("grok_"));
}

#[test]
fn login_status_parsing() {
    assert!(!parse_logged_in("Not logged in\n"));
    assert!(!parse_logged_in("\u{1b}[31mNot logged in\u{1b}[0m"));
    assert!(parse_logged_in(
        "\u{1b}[32m✓\u{1b}[0m Logged in as someone@example.com"
    ));
    assert!(!parse_logged_in(""));
}

#[test]
fn login_url_parsing() {
    let out = "Starting login process...\nWaiting for browser authentication...\nOpen a browser and navigate to this link: https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login&redirectTarget=cli\n";
    assert_eq!(
        parse_login_url(out).as_deref(),
        Some("https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login&redirectTarget=cli")
    );
    assert_eq!(parse_login_url("no url here"), None);
    assert_eq!(parse_login_url("see https://evil.example.com/x"), None);
}

#[test]
fn grok_keys_flagged_for_worker() {
    assert!(key_unsupported_by_worker("grok_0123_abcd"));
    assert!(!key_unsupported_by_worker("crsr_0123456789abcdef"));
    // grok_ n'est pas rejeté (Cursor pourra le corriger), seulement signalé.
    assert!(validate_api_key("grok_0123456789abcdef0123456789abcdef_x").is_ok());
}

/// Démarrage sans clé : exige une session `login` (faux CLI « Not logged in »).
#[cfg(target_os = "linux")]
#[test]
fn start_without_key_requires_login() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("cw-login-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let fake = dir.join("cursor-agent");
    std::fs::write(
        &fake,
        "#!/bin/sh\n[ \"$1\" = status ] && echo 'Not logged in'\nexit 0\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(!is_logged_in(&fake));
    std::fs::write(
        &fake,
        "#!/bin/sh\n[ \"$1\" = status ] && echo 'Logged in as me@example.com'\nexit 0\n",
    )
    .unwrap();
    assert!(is_logged_in(&fake));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn repo_worker_args_serve_exactly_one_repo() {
    let a = build_repo_worker_args("devforge", "/data/apps/template-studio", "/d/repos/x/data");
    assert_eq!(
        a,
        vec![
            "worker",
            "--name",
            "devforge",
            "--worker-dir",
            "/data/apps/template-studio",
            "--data-dir",
            "/d/repos/x/data",
            "start"
        ]
    );
    assert!(!a.iter().any(|x| x == "--management-addr"));
    assert!(!a.iter().any(|x| x == "--api-key"));
}

#[test]
fn repo_slot_ids_are_stable_and_distinct() {
    let a = repo_slot_id("/data/devforge/applications/02792add-bf8d");
    assert_eq!(a, repo_slot_id("/data/devforge/applications/02792add-bf8d"));
    assert!(a.starts_with("02792add-bf8d-"), "{a}");
    // Même nom de dossier, chemins différents → identifiants différents.
    assert_ne!(repo_slot_id("/a/app"), repo_slot_id("/b/app"));
    assert!(repo_slot_id("/").starts_with("repo-"));
    assert!(repo_slot_id("/x/Mon Projet!").starts_with("mon-projet-"));
}

#[test]
fn script_output_logs_never_show_url_tokens() {
    let out = "DF_RUNNING=1\nDF_REPOS_UP=3\nDF_LOGS_BEGIN\nfatal: https://x-access-token:ghp_FAKE123@github.com/o/r.git\n";
    let r = parse_script_output(out);
    assert_eq!(r.repos_up, Some(3));
    assert!(!r.logs.contains("ghp_FAKE123"), "{}", r.logs);
    assert!(r.logs.contains("https://***@github.com/o/r.git"));
}

#[cfg(unix)]
#[test]
fn git_remote_is_redacted() {
    let tmp = std::env::temp_dir().join(format!("cw-remote-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(&tmp)
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    if !git(&["init", "-q"]) {
        return; // git absent : rien à vérifier.
    }
    assert!(git(&[
        "remote",
        "add",
        "origin",
        "https://x-access-token:ghp_FAKE0123456789@github.com/o/r.git",
    ]));
    let r = read_git_remote(&tmp).unwrap();
    assert_eq!(r, "https://***@github.com/o/r.git");
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn one_machine_name_per_repo() {
    assert_eq!(
        repo_label(
            Some("https://***@github.com/bobdivx/template-studio.git"),
            "/data/x/02792add"
        ),
        "template-studio"
    );
    assert_eq!(repo_label(Some("git@github.com:o/Repo.git"), "/x"), "repo");
    assert_eq!(
        repo_label(None, "/data/devforge/applications/jeser"),
        "jeser"
    );
    assert_eq!(repo_label(Some(""), "/"), "repo");
    let names = repo_worker_names_from(
        "DevForge",
        &[
            "vigie".into(),
            "template-studio".into(),
            "jeser".into(),
            "jeser".into(),
        ],
    );
    assert_eq!(
        names,
        vec![
            "devforge-vigie",
            "devforge-template-studio",
            "devforge-jeser",
            "devforge-jeser-2"
        ]
    );
    // Tous distincts : c'est ce qui donne un workerId par dépôt.
    let mut d = names.clone();
    d.dedup();
    assert_eq!(d.len(), names.len());
    assert_eq!(repo_worker_names_from("", &["a".into()]), vec!["a"]);
}

#[cfg(unix)]
#[test]
fn repo_worker_names_read_origin_remote() {
    let tmp = std::env::temp_dir().join(format!("cw-names-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let a = tmp.join("02792add-bf8d");
    std::fs::create_dir_all(&a).unwrap();
    let ok = std::process::Command::new("git")
        .arg("-C")
        .arg(&a)
        .args(["init", "-q"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !ok {
        return;
    }
    std::process::Command::new("git")
        .arg("-C")
        .arg(&a)
        .args([
            "remote",
            "add",
            "origin",
            "https://x-access-token:ghp_FAKE@github.com/bobdivx/template-studio.git",
        ])
        .status()
        .unwrap();
    let names = repo_worker_names("devforge", &[a.display().to_string()]);
    assert_eq!(names, vec!["devforge-template-studio"]);
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn cursor_worktree_path_and_branch_rules() {
    assert_eq!(
        cursor_worktree_path("/data/devforge/applications/02792add/"),
        "/data/devforge/applications/02792add-cursor"
    );
    assert_eq!(safe_branch(" main "), Some("main".into()));
    assert_eq!(safe_branch("release/2.0"), Some("release/2.0".into()));
    assert_eq!(safe_branch(""), None);
    assert_eq!(safe_branch("-x"), None);
    assert_eq!(safe_branch("a..b"), None);
    assert_eq!(safe_branch("main; rm -rf /"), None);
    let d = worker_dir_for("u".into(), "Cheval".into(), "/nope/cheval".into(), "");
    assert!(!d.eligible);
    assert_eq!(d.path, "/nope/cheval-cursor");
    assert_eq!(d.note.as_deref(), Some(NO_CHECKOUT_NOTE));
    assert_eq!(d.branch, "main");
    // Les projets sans checkout ne sont jamais servis.
    assert!(eligible_paths(&[d], "").is_empty());
}

/// Dépôt « GitHub » (bare) + checkout de déploiement, comme sur le serveur.
#[cfg(unix)]
fn deploy_like_checkout(tmp: &Path) -> Option<PathBuf> {
    let run = |dir: &Path, args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    let _ = std::fs::remove_dir_all(tmp);
    std::fs::create_dir_all(tmp).ok()?;
    let origin = tmp.join("origin.git");
    let src = tmp.join("app");
    let seed = tmp.join("seed");
    std::fs::create_dir_all(&seed).ok()?;
    if !run(tmp, &["init", "-q", "--bare", "-b", "main", "origin.git"]) {
        return None;
    }
    std::fs::write(seed.join("index.html"), "v1").ok()?;
    let ok = run(&seed, &["init", "-q", "-b", "main"])
        && run(&seed, &["add", "."])
        && run(&seed, &["commit", "-q", "-m", "v1"])
        && run(
            &seed,
            &["remote", "add", "origin", &origin.display().to_string()],
        )
        && run(&seed, &["push", "-q", "origin", "main"])
        && run(
            tmp,
            &[
                "clone",
                "-q",
                "-b",
                "main",
                &origin.display().to_string(),
                "app",
            ],
        );
    ok.then_some(src)
}

#[cfg(unix)]
fn git_out(dir: &Path, args: &[&str]) -> String {
    let o = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t"])
        .args(args)
        .output()
        .unwrap();
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

#[cfg(unix)]
#[test]
fn cursor_worktree_is_separate_from_deploy_checkout() {
    let tmp = std::env::temp_dir().join(format!("cw-wt-{}", std::process::id()));
    let Some(src) = deploy_like_checkout(&tmp) else {
        return; // git absent
    };
    let wt = PathBuf::from(cursor_worktree_path(&src.display().to_string()));

    // Pas de checkout : rien n'est créé.
    let missing = tmp.join("cheval");
    std::fs::create_dir_all(&missing).unwrap();
    assert_eq!(
        ensure_cursor_worktree(&missing, Some("main")).unwrap_err(),
        NO_CHECKOUT_NOTE
    );
    assert!(!tmp.join("cheval-cursor").exists());

    // Création : branche cursor/devforge partant d'origin/main.
    let w = ensure_cursor_worktree(&src, Some("main")).unwrap();
    assert!(w.created);
    assert_eq!(w.path, wt.display().to_string());
    assert_eq!(
        git_out(&wt, &["symbolic-ref", "--short", "HEAD"]),
        CURSOR_BRANCH
    );
    assert_eq!(
        git_out(&wt, &["rev-parse", "HEAD"]),
        git_out(&src, &["rev-parse", "origin/main"])
    );
    // Le checkout de déploiement reste sur sa branche, propre.
    assert_eq!(git_out(&src, &["symbolic-ref", "--short", "HEAD"]), "main");
    assert_eq!(git_out(&src, &["status", "--porcelain"]), "");

    // Un agent travaille dans le worktree…
    std::fs::write(wt.join("index.html"), "agent").unwrap();
    // …un déploiement (même commande que git_sync_command) ne le touche pas.
    for args in [
        &["fetch", "-q", "origin"][..],
        &["checkout", "-q", "main"][..],
        &["reset", "-q", "--hard", "origin/main"][..],
    ] {
        git_out(&src, args);
    }
    assert_eq!(
        std::fs::read_to_string(wt.join("index.html")).unwrap(),
        "agent"
    );
    assert_eq!(git_out(&src, &["status", "--porcelain"]), "");
    assert_eq!(
        std::fs::read_to_string(src.join("index.html")).unwrap(),
        "v1"
    );

    // Déjà présent : laissé tel quel (changements conservés).
    let again = ensure_cursor_worktree(&src, Some("main")).unwrap();
    assert!(!again.created);
    assert_eq!(
        std::fs::read_to_string(wt.join("index.html")).unwrap(),
        "agent"
    );
    // Chemin `-cursor` déjà présent : start_named ne recrée rien.
    let (paths, errs) = ensure_worktrees_for(&[wt.display().to_string()]);
    assert_eq!(paths, vec![wt.display().to_string()]);
    assert!(errs.is_empty());

    // « Remettre à jour » : sauvegarde puis retour sur origin/main.
    let root = tmp.join("backups");
    let id = refresh_cursor_worktree(&wt, "main", &root).unwrap();
    let id = id.expect("changements sauvegardés");
    assert!(root.join(&id).join("files.tar.gz").exists());
    assert_eq!(
        std::fs::read_to_string(wt.join("index.html")).unwrap(),
        "v1"
    );
    assert_eq!(
        git_out(&wt, &["symbolic-ref", "--short", "HEAD"]),
        CURSOR_BRANCH
    );
    // Propre : pas de nouvelle sauvegarde.
    assert_eq!(refresh_cursor_worktree(&wt, "main", &root).unwrap(), None);

    // Dossier `-cursor` supprimé à la main : recréé, la branche est reprise.
    std::fs::remove_dir_all(&wt).unwrap();
    let w = ensure_cursor_worktree(&src, None).unwrap();
    assert!(w.created);
    assert_eq!(
        git_out(&wt, &["symbolic-ref", "--short", "HEAD"]),
        CURSOR_BRANCH
    );

    // Dossier occupé (pas un dépôt) : jamais écrasé.
    let other = tmp.join("other");
    let other_src = tmp.join("app2");
    std::fs::create_dir_all(&other).unwrap();
    git_out(
        &tmp,
        &[
            "clone",
            "-q",
            &tmp.join("origin.git").display().to_string(),
            "app2",
        ],
    );
    let busy = tmp.join("app2-cursor");
    std::fs::create_dir_all(&busy).unwrap();
    std::fs::write(busy.join("keep.txt"), "x").unwrap();
    assert!(ensure_cursor_worktree(&other_src, Some("main")).is_err());
    assert_eq!(std::fs::read_to_string(busy.join("keep.txt")).unwrap(), "x");

    let _ = std::fs::remove_dir_all(&tmp);
}
