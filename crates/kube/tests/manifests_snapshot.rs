//! Snapshots des manifests générés. Régénérer : `UPDATE_SNAPSHOTS=1 cargo test -p devforge-kube`.

use std::path::PathBuf;

use devforge_kube::{render, AppSpec, HealthSpec, KubeDefaults, ResourceSpec, TlsSpec};

fn check(name: &str, value: &serde_json::Value) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/snapshots")
        .join(format!("{name}.json"));
    let actual = serde_json::to_string_pretty(value).unwrap() + "\n";
    if std::env::var_os("UPDATE_SNAPSHOTS").is_some() || !path.exists() {
        std::fs::write(&path, &actual).unwrap();
        if std::env::var_os("UPDATE_SNAPSHOTS").is_none() {
            panic!("snapshot {name} créé — relancer le test");
        }
        return;
    }
    // Comparaison structurelle : indépendante de l'ordre des clés et des fins de ligne.
    let expected: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert!(
        &expected == value,
        "snapshot {name} différent — UPDATE_SNAPSHOTS=1 pour régénérer\n--- attendu\n{}\n--- obtenu\n{actual}",
        serde_json::to_string_pretty(&expected).unwrap()
    );
}

#[test]
fn minimal_app_snapshot() {
    let mut spec = AppSpec::new("hello", "ghcr.io/bobdivx/hello:1.0.0");
    spec.normalize().unwrap();
    let r = render(&spec, &KubeDefaults::new("devforge-apps"));
    check("minimal", &r.redacted());
}

#[test]
fn full_app_snapshot() {
    let mut spec = AppSpec::new("shop", "ghcr.io/bobdivx/shop:sha-abc1234");
    spec.port = 3000;
    spec.replicas = 2;
    spec.host = Some("shop.example.com".into());
    spec.tls = Some(TlsSpec {
        secret_name: None,
        cluster_issuer: Some("letsencrypt-prod".into()),
    });
    spec.env.insert("NODE_ENV".into(), "production".into());
    spec.env.insert("PORT".into(), "3000".into());
    spec.secrets
        .insert("DATABASE_URL".into(), "postgres://u:p@db/shop".into());
    spec.health = Some(HealthSpec {
        path: Some("/healthz".into()),
        initial_delay_seconds: Some(10),
        period_seconds: None,
        failure_threshold: None,
    });
    spec.resources = Some(ResourceSpec {
        memory: Some("512m".into()),
        cpus: Some("0.5".into()),
    });
    spec.image_pull_secret = Some("ghcr-pull".into());
    spec.run_as_user = Some(1000);
    spec.project_uuid = Some("0b6f0c1e-1111-4222-8333-944445555666".into());
    spec.normalize().unwrap();
    let mut d = KubeDefaults::new("devforge-apps");
    d.ingress_class = Some("traefik".into());
    let r = render(&spec, &d);
    let redacted = r.redacted();
    assert!(!redacted.to_string().contains("postgres://u:p@db/shop"));
    check("full", &redacted);
}
