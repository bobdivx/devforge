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
        &["/data/applications/a".into()],
        key,
    );
    assert!(s.contains("CURSOR_API_KEY='key_SECRET_0123456789'"));
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
        &[repo.display().to_string(), "/nope".into()],
        "key_0123456789abcdef",
    ));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}");
    let r = parse_script_output(&stdout);
    assert!(r.running);
    assert_eq!(r.dirs, vec![repo.display().to_string()]);
    let log = std::fs::read_to_string(base_dir.join("worker.out")).unwrap();
    assert!(log.contains("--name demo"));
    assert!(log.contains("--worker-dir"));
    assert!(!log.contains("key_0123456789abcdef"));

    let out = run(&status_script(&base));
    let r = parse_script_output(&String::from_utf8_lossy(&out.stdout));
    assert!(r.running);
    assert_eq!(r.version.as_deref(), Some("9.9.9"));

    let out = run(&stop_script(&base));
    let r = parse_script_output(&String::from_utf8_lossy(&out.stdout));
    assert!(!r.running);
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
    assert!(INVALID_KEY_HINT.contains("cursor.com/dashboard"));
}
