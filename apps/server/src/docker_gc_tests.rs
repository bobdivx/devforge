use super::emergency_due;
use crate::docker_gc::*;
use chrono::{Duration, TimeZone, Utc};
use std::time::Instant;

fn now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 21, 3, 0, 0).unwrap()
}

fn img(id: &str, hours_old: i64, size: u64, tags: &[&str]) -> ImageInfo {
    ImageInfo {
        id: format!("sha256:{id}"),
        created: now() - Duration::hours(hours_old),
        size,
        tags: tags.iter().map(|t| t.to_string()).collect(),
    }
}

fn ctr(image: &str, state: &str) -> ContainerInfo {
    ContainerInfo {
        id: format!("c-{image}"),
        image_id: format!("sha256:{image}"),
        state: state.into(),
        name: format!("df-{image}"),
    }
}

fn bk() -> Vec<String> {
    vec!["buildx_buildkit_builder-x0".to_string()]
}

fn removed(plan: &ImagePlan) -> Vec<String> {
    let mut v: Vec<String> = plan
        .remove
        .iter()
        .map(|c| c.id.trim_start_matches("sha256:").to_string())
        .collect();
    v.sort();
    v
}

#[test]
fn defaults_match_spec() {
    let s = GcSettings::default();
    assert!(s.enabled);
    assert_eq!(s.frequency_hours, 24);
    assert_eq!(s.hour, 3);
    assert_eq!(s.timezone, "Europe/Paris");
    assert_eq!(s.retention_hours, 24);
    assert_eq!(s.keep_per_project, 3);
    assert_eq!(s.disk_alert_percent, 85);
    assert!(!s.log_rotation);
    assert_eq!(s.cron_expression(), "0 3 * * *");
    assert!(s.validate().is_ok());
    assert!(s.next_run().is_some());
}

#[test]
fn schedule_expressions_and_validation() {
    let mut s = GcSettings {
        frequency_hours: 6,
        hour: 3,
        ..Default::default()
    };
    assert_eq!(s.cron_expression(), "0 3,9,15,21 * * *");
    s.frequency_hours = 12;
    s.hour = 20;
    assert_eq!(s.cron_expression(), "0 8,20 * * *");
    s.frequency_hours = 48;
    assert_eq!(s.cron_expression(), "0 20 */2 * *");
    s.frequency_hours = 168;
    assert_eq!(s.cron_expression(), "0 20 * * 1");
    s.cron = Some("30 4 * * *".into());
    assert_eq!(s.cron_expression(), "30 4 * * *");
    assert!(s.validate().is_ok());
    s.cron = Some("* * * * *".into());
    assert!(s.validate().is_err(), "plus d'un passage par heure refusé");
    let bad = GcSettings {
        frequency_hours: 5,
        ..Default::default()
    };
    assert!(bad.validate().is_err());
    let bad = GcSettings {
        disk_alert_percent: 100,
        ..Default::default()
    };
    assert!(bad.validate().is_err());
    let bad = GcSettings {
        keep_per_project: 0,
        ..Default::default()
    };
    assert!(bad.validate().is_err());
}

#[test]
fn settings_json_is_backward_compatible() {
    let s: GcSettings = serde_json::from_str(r#"{"enabled":false}"#).unwrap();
    assert!(!s.enabled);
    assert_eq!(s.keep_per_project, 3);
}

#[test]
fn retention_applies_to_unused_non_project_images() {
    let images = vec![
        img("old", 48, 100, &["node:24-bookworm"]),
        img("fresh", 2, 100, &["node:22"]),
        img("dangling-old", 30, 50, &[]),
        img("dangling-new", 1, 50, &[]),
    ];
    let plan = select_images(&images, &[], now(), 24, 3);
    assert_eq!(removed(&plan), vec!["dangling-old", "old"]);
    let dangling = plan
        .remove
        .iter()
        .find(|c| c.id.ends_with("dangling-old"))
        .unwrap();
    assert_eq!(dangling.refs, vec!["sha256:dangling-old".to_string()]);
    assert_eq!(plan.bytes(), 150);
}

#[test]
fn keeps_n_most_recent_images_per_project() {
    let images = vec![
        img("p1", 1, 10, &["df-abc123def456:latest"]),
        img("p2", 10, 10, &["df-abc123def456:r2"]),
        img("p3", 20, 10, &["df-abc123def456:r3"]),
        img("p4", 30, 10, &["df-abc123def456:r4"]),
        img("p5", 2, 10, &["df-abc123def456:r5"]),
        img("q1", 100, 10, &["df-zzz:r1"]),
    ];
    let plan = select_images(&images, &[ctr("p1", "running")], now(), 24, 3);
    // Récentes gardées : p1 (courante), p5, p2. p3/p4 au-delà de 3 — même si < 24 h.
    assert_eq!(removed(&plan), vec!["p3", "p4"]);
    let c = plan.remove.iter().find(|c| c.id.ends_with("p3")).unwrap();
    assert_eq!(c.project.as_deref(), Some("df-abc123def456"));
    assert_eq!(c.refs, vec!["df-abc123def456:r3".to_string()]);
    // Seule image de l'autre projet : gardée même vieille.
    assert!(plan.kept.iter().any(|k| k.id.ends_with("q1")));
}

#[test]
fn running_and_stopped_container_images_are_never_selected() {
    let images = vec![
        img("run", 500, 10, &["postgres:16"]),
        img("stop", 500, 10, &["redis:7"]),
        img("old1", 500, 10, &["df-abc:r1"]),
        img("old2", 400, 10, &["df-abc:r2"]),
        img("old3", 300, 10, &["df-abc:r3"]),
        img("old4", 200, 10, &["df-abc:r4"]),
    ];
    let containers = vec![
        ctr("run", "running"),
        ctr("stop", "exited"),
        // conteneur arrêté sur la plus vieille image du projet
        ctr("old1", "exited"),
    ];
    let plan = select_images(&images, &containers, now(), 1, 1);
    let r = removed(&plan);
    assert!(!r.contains(&"run".to_string()));
    assert!(!r.contains(&"stop".to_string()));
    assert!(!r.contains(&"old1".to_string()));
    assert_eq!(r, vec!["old2", "old3"]);
    assert!(plan
        .kept
        .iter()
        .any(|k| k.id.ends_with("stop") && k.reason.contains("arrêté")));
}

#[test]
fn current_deploy_latest_is_never_selected() {
    // Même hors des N et sans conteneur : `df-…:latest` est l'image courante.
    let images = vec![
        img("new1", 1, 10, &["df-abc:r9"]),
        img("cur", 50, 10, &["df-abc:latest"]),
    ];
    let plan = select_images(&images, &[], now(), 24, 1);
    assert!(plan.remove.iter().all(|c| !c.id.ends_with("cur")));
}

#[test]
fn unsafe_refs_are_skipped() {
    let images = vec![img("evil", 100, 10, &["bad;rm -rf /:x"])];
    let plan = select_images(&images, &[], now(), 24, 3);
    assert!(plan.remove.is_empty());
}

#[test]
fn cleanup_script_never_touches_volumes_or_containers() {
    let images = vec![
        img("old", 48, 100, &["node:24"]),
        img("dangling", 48, 100, &[]),
    ];
    let plan = select_images(&images, &[], now(), 24, 3);
    for cmd in [
        cleanup_command(&["default".into(), "multi".into()], &bk(), Some(24), &plan),
        cleanup_command(&[], &[], None, &plan),
        inventory_command(),
        disk_command(),
        cache_du_command(&["default".into()], &bk(), Some(24)),
        retire_legacy_guard_command(),
    ] {
        let lower = cmd.to_ascii_lowercase();
        assert!(!lower.contains("volume"), "{cmd}");
        assert!(!lower.contains("container prune"), "{cmd}");
        assert!(!lower.contains("system prune"), "{cmd}");
        assert!(!lower.contains("docker rm "), "{cmd}");
        assert!(!lower.contains(" rm -f"), "{cmd}");
        assert!(!lower.contains("rmi -f"), "{cmd}");
        assert!(!lower.contains("--force"), "{cmd}");
        assert!(!lower.contains("image prune"), "{cmd}");
    }
    let cmd = cleanup_command(&["default".into(), "multi".into()], &bk(), Some(24), &plan);
    assert!(
        cmd.contains("docker exec 'buildx_buildkit_builder-x0' buildctl prune --keep-duration 24h")
    );
    assert!(cmd.contains("export DOCKER_CONFIG=/tmp/devforge-docker-gc"));
    assert!(cmd.contains("docker buildx prune --builder 'default' -f --filter until=24h"));
    assert!(cmd.contains("docker buildx prune --builder 'multi' -f --filter until=24h"));
    assert!(cmd.contains("docker image rm 'node:24'"));
    assert!(cmd.contains("docker image rm 'sha256:dangling'"));
    // Urgence : tout le cache inutilisé, sans filtre d'âge.
    let urgent = cleanup_command(&[], &bk(), None, &plan);
    assert!(urgent.contains("buildctl prune 2>&1"));
    assert!(
        urgent.contains("docker builder prune -f;")
            || urgent.contains("docker builder prune -f 2>&1")
    );
    // Builder au nom douteux ignoré.
    let cmd = cleanup_command(
        &["x;rm".into()],
        &["y;rm".into()],
        Some(24),
        &ImagePlan::default(),
    );
    assert!(!cmd.contains("x;rm"));
    assert!(!cmd.contains("y;rm"));
}

#[test]
fn inventory_is_parsed() {
    let out = "\
@@info
/media/Docker/docker|json-file|27.5.1
@@df
/dev/sda1 465000000 395250000 69750000 85% /media/Docker
@@legacy
present
@@images
sha256:aaa|2026-10-20T01:00:00.123456789Z|1000|df-abc:latest,df-abc:r1
sha256:bbb|2026-10-01T01:00:00+02:00|2000|
sha256:aaa|2026-10-20T01:00:00Z|1000|df-abc:latest
garbage line
@@containers
c1|sha256:aaa|running|/df-abc
c2|sha256:bbb|exited|/old
@@builders
NAME/NODE     DRIVER/ENDPOINT   STATUS    BUILDKIT   PLATFORMS
default*      docker
 \\_ default    \\_ default       running   v0.13.2    linux/amd64
multi         docker-container
  multi0      unix:///var/run/docker.sock running v0.12 linux/amd64
@@buildkit
buildx_buildkit_builder-x0
buildx_buildkit_bad;name
@@sysdf
Images|40GB|12GB (30%)
Build Cache|380GB|300GB
@@end
";
    let inv = parse_inventory(out);
    assert_eq!(inv.disk.root_dir, "/media/Docker/docker");
    assert_eq!(inv.disk.logging_driver, "json-file");
    assert_eq!(inv.disk.total_bytes, 465000000 * 1024);
    assert!((inv.disk.percent - 85.0).abs() < 0.1);
    assert_eq!(inv.images.len(), 2, "doublons et lignes invalides ignorés");
    assert_eq!(inv.images[0].tags, vec!["df-abc:latest", "df-abc:r1"]);
    assert!(inv.images[1].tags.is_empty());
    assert_eq!(inv.containers.len(), 2);
    assert_eq!(inv.containers[1].state, "exited");
    assert_eq!(inv.containers[0].name, "df-abc");
    assert_eq!(inv.builders, vec!["default", "multi"]);
    assert_eq!(inv.buildkit, vec!["buildx_buildkit_builder-x0"]);
    assert_eq!(inv.disk.legacy_guard, "present");
    assert_eq!(inv.system_df.len(), 2);
}

#[test]
fn sizes_and_cache_du_are_parsed() {
    assert_eq!(parse_size("0B"), Some(0));
    assert_eq!(parse_size("12.5kB"), Some(12_500));
    assert_eq!(parse_size("1.5GB"), Some(1_500_000_000));
    assert_eq!(parse_size("2GiB"), Some(2 * 1024 * 1024 * 1024));
    assert_eq!(parse_size("300GB (45%)"), Some(300_000_000_000));
    assert_eq!(parse_size(""), None);
    assert_eq!(parse_size("abc"), None);
    let out = "@@cache\ndefault|1.2GB\nmulti|\n@@end\n";
    assert_eq!(
        parse_cache_du(out),
        vec![
            ("default".to_string(), 1_200_000_000),
            ("multi".to_string(), 0)
        ]
    );
}

#[test]
fn cleanup_output_is_parsed() {
    let out = "\
@@cache default
Total:	3.2GB
@@rmi df-abc:r1
Untagged: df-abc:r1
@@rmi df-abc:r2
Untagged: df-abc:r2
Deleted: sha256:111
Deleted: sha256:222
@@rmi node:24
Error response from daemon: conflict: unable to remove repository reference \"node:24\" (must force) - container 123 is using its referenced image
@@avail 1000 5000
@@end
";
    let o = parse_cleanup(out);
    assert_eq!(o.freed_bytes, 4000 * 1024);
    assert_eq!(o.images_removed, 1);
    assert_eq!(o.errors.len(), 1);
    assert!(o.errors[0].starts_with("rmi node:24"));
}

#[test]
fn emergency_threshold_and_cooldown() {
    let t = Instant::now();
    assert!(emergency_due(90.0, 85, None, t));
    assert!(!emergency_due(80.0, 85, None, t));
    assert!(!emergency_due(99.0, 85, Some(t), t));
    let later = t + std::time::Duration::from_secs(3601);
    assert!(emergency_due(99.0, 85, Some(t), later));
}

#[test]
fn legacy_guard_is_moved_not_deleted_and_never_touches_other_crons() {
    let cmd = retire_legacy_guard_command();
    assert!(cmd.contains("/etc/cron.d/devforge-disk-guard"));
    assert!(cmd.contains("mv "));
    assert!(!cmd.contains("rm "));
    assert!(!cmd.contains("docker-cleanup-interim"));
    assert!(cmd.contains("[ ! -f /.dockerenv ]"));
    assert!(disk_command().contains("@@legacy"));
}
