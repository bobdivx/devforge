//! Test contre une vraie API Kubernetes (kind, Talos, envtest…). Ignoré sans
//! `DEVFORGE_KUBE_IT=1`. Variables : `DEVFORGE_KUBE_API_URL`, `DEVFORGE_KUBE_TOKEN_FILE`,
//! `DEVFORGE_KUBE_NAMESPACE` (namespace déjà créé, RBAC du chart Helm),
//! `DEVFORGE_KUBE_CA_FILE` ou `DEVFORGE_KUBE_INSECURE_SKIP_TLS_VERIFY=1`.
//!
//! Sans contrôleurs (envtest), les pods ne démarrent pas : on vérifie l'API (apply, prune,
//! stop/start/restart, RBAC), pas l'exécution des conteneurs.

use devforge_kube::client::paths;
use devforge_kube::runtime::ImageRuntime;
use devforge_kube::{AppSpec, KubeError, KubeRuntime, TlsSpec};
use serde_json::json;

fn enabled() -> bool {
    std::env::var("DEVFORGE_KUBE_IT").as_deref() == Ok("1")
}

#[tokio::test]
async fn live_deploy_lifecycle() {
    if !enabled() {
        eprintln!("DEVFORGE_KUBE_IT absent — test cluster ignoré");
        return;
    }
    let rt = KubeRuntime::from_env().expect("config kube");
    let ns = rt.namespace().to_string();
    let name = "it-web";
    let _ = rt.remove(name).await;

    let mut spec = AppSpec::new(name, "nginxinc/nginx-unprivileged:1.27");
    spec.port = 8080;
    spec.replicas = 2;
    spec.host = Some("it-web.example.test".into());
    spec.tls = Some(TlsSpec::default());
    spec.env.insert("MODE".into(), "test".into());
    spec.secrets.insert("API_KEY".into(), "it-secret".into());
    let out = rt.deploy(&spec).await.expect("deploy");
    assert_eq!(
        out.applied,
        vec![
            "Secret/it-web-env",
            "Deployment/it-web",
            "Service/it-web",
            "Ingress/it-web"
        ]
    );
    assert!(["progressing", "running"].contains(&out.status.phase.as_str()));
    let c = rt.client();
    let dep = c
        .get(&paths::deployment(&ns, name))
        .await
        .unwrap()
        .expect("deployment");
    let gen1 = dep["metadata"]["generation"].as_i64().unwrap();
    let hash1 = dep["spec"]["template"]["metadata"]["annotations"]["devforge.io/config-hash"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        dep["spec"]["template"]["spec"]["containers"][0]["envFrom"][0]["secretRef"]["name"],
        "it-web-env"
    );

    // Rolling update : nouvelle image, plus d'Ingress ni de Secret → élagués.
    let mut v2 = AppSpec::new(name, "nginxinc/nginx-unprivileged:1.27-alpine");
    v2.port = 8080;
    v2.replicas = 2;
    let out = rt.deploy(&v2).await.expect("redeploy");
    assert_eq!(out.pruned, vec!["Ingress/it-web", "Secret/it-web-env"]);
    let dep = c.get(&paths::deployment(&ns, name)).await.unwrap().unwrap();
    assert!(dep["metadata"]["generation"].as_i64().unwrap() > gen1);
    assert_ne!(
        dep["spec"]["template"]["metadata"]["annotations"]["devforge.io/config-hash"],
        json!(hash1)
    );
    assert_eq!(
        dep["spec"]["template"]["spec"]["containers"][0]["image"],
        "nginxinc/nginx-unprivileged:1.27-alpine"
    );

    let st = rt.stop(name).await.expect("stop");
    assert_eq!(st.phase, "stopped");
    let st = rt.start(name).await.expect("start");
    assert_eq!(st.replicas, 2);
    rt.restart(name).await.expect("restart");
    let dep = c.get(&paths::deployment(&ns, name)).await.unwrap().unwrap();
    assert!(dep["spec"]["template"]["metadata"]["annotations"]
        .get("kubectl.kubernetes.io/restartedAt")
        .is_some());

    let logs = rt.logs(name, 50).await.expect("logs");
    assert_eq!(logs.name, name);
    assert!(rt.list().await.unwrap().iter().any(|a| a.name == name));

    // Une ressource non gérée par DevForge n'est jamais écrasée.
    let foreign = json!({
        "apiVersion": "apps/v1", "kind": "Deployment",
        "metadata": { "name": "it-foreign", "namespace": ns },
        "spec": {
            "selector": { "matchLabels": { "x": "y" } },
            "template": { "metadata": { "labels": { "x": "y" } },
                "spec": { "containers": [{ "name": "c", "image": "busybox" }] } }
        }
    });
    let fp = paths::deployment(&ns, "it-foreign");
    let _ = c.delete(&fp).await;
    if c.apply(&fp, &foreign).await.is_ok() {
        let err = rt
            .deploy(&AppSpec::new("it-foreign", "busybox:1"))
            .await
            .unwrap_err();
        assert!(matches!(err, KubeError::Invalid(_)), "{err}");
        assert!(rt.remove("it-foreign").await.unwrap().is_empty());
        let _ = c.delete(&fp).await;
    }

    let removed = rt.remove(name).await.expect("remove");
    assert_eq!(removed, vec!["Service/it-web", "Deployment/it-web"]);
    assert_eq!(rt.status(name).await.unwrap().phase, "absent");

    // RBAC : le compte de service n'a aucun droit hors de son namespace.
    if let Ok(other) = std::env::var("DEVFORGE_KUBE_IT_FORBIDDEN_NS") {
        let err = c.get(&paths::deployments(&other)).await.unwrap_err();
        assert!(matches!(err, KubeError::Api { status: 403, .. }), "{err}");
    }
}
