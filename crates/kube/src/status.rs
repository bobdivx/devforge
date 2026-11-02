//! Statut d'une app calculé à partir du Deployment et de ses pods (fonctions pures).

use serde::Serialize;
use serde_json::Value;

use crate::manifests::ANNOTATION_REPLICAS;
use crate::CONTAINER_NAME;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PodStatus {
    pub name: String,
    pub phase: String,
    pub ready: bool,
    pub restarts: i64,
    /// Raison d'attente / d'arrêt du conteneur (`ImagePullBackOff`, `CrashLoopBackOff`…).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppStatus {
    pub name: String,
    pub namespace: String,
    /// `absent` | `stopped` | `progressing` | `running` | `degraded`
    pub phase: String,
    pub healthy: bool,
    pub rollout_complete: bool,
    pub image: Option<String>,
    pub replicas: i64,
    pub ready_replicas: i64,
    pub updated_replicas: i64,
    pub available_replicas: i64,
    pub message: String,
    pub pods: Vec<PodStatus>,
}

fn i(v: &Value, path: &[&str]) -> i64 {
    let mut cur = v;
    for p in path {
        match cur.get(p) {
            Some(n) => cur = n,
            None => return 0,
        }
    }
    cur.as_i64().unwrap_or(0)
}

fn s(v: &Value, path: &[&str]) -> Option<String> {
    let mut cur = v;
    for p in path {
        cur = cur.get(p)?;
    }
    cur.as_str().map(str::to_string)
}

/// Pods d'une `PodList`, du plus récent au plus ancien.
pub fn pods_from_list(list: &Value) -> Vec<PodStatus> {
    let mut pods: Vec<PodStatus> = list
        .get("items")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(pod_status).collect())
        .unwrap_or_default();
    pods.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.name.cmp(&b.name)));
    pods
}

fn pod_status(pod: &Value) -> PodStatus {
    let cs = pod
        .pointer("/status/containerStatuses")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .find(|c| c.get("name").and_then(Value::as_str) == Some(CONTAINER_NAME))
                .or_else(|| a.first())
        });
    let reason = cs.and_then(|c| {
        s(c, &["state", "waiting", "reason"])
            .or_else(|| s(c, &["state", "terminated", "reason"]))
            .or_else(|| s(c, &["lastState", "terminated", "reason"]))
    });
    let reason = reason.or_else(|| {
        pod.pointer("/status/conditions")
            .and_then(Value::as_array)
            .and_then(|a| {
                a.iter().find(|c| {
                    c.get("type").and_then(Value::as_str) == Some("PodScheduled")
                        && c.get("status").and_then(Value::as_str) == Some("False")
                })
            })
            .and_then(|c| s(c, &["reason"]))
    });
    PodStatus {
        name: s(pod, &["metadata", "name"]).unwrap_or_default(),
        phase: s(pod, &["status", "phase"]).unwrap_or_else(|| "Unknown".into()),
        ready: cs
            .and_then(|c| c.get("ready"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        restarts: cs.map(|c| i(c, &["restartCount"])).unwrap_or(0),
        reason,
        image: cs.and_then(|c| s(c, &["image"])),
        created_at: s(pod, &["metadata", "creationTimestamp"]),
    }
}

/// Réplicas à restaurer après un stop (annotation, défaut 1).
pub fn remembered_replicas(deployment: &Value) -> i64 {
    deployment
        .pointer("/metadata/annotations")
        .and_then(|a| a.get(ANNOTATION_REPLICAS))
        .and_then(Value::as_str)
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(1)
}

/// Statut agrégé. `deployment = None` → `absent`.
pub fn app_status(
    name: &str,
    namespace: &str,
    deployment: Option<&Value>,
    pods: Vec<PodStatus>,
) -> AppStatus {
    let Some(dep) = deployment else {
        return AppStatus {
            name: name.into(),
            namespace: namespace.into(),
            phase: "absent".into(),
            healthy: false,
            rollout_complete: false,
            image: None,
            replicas: 0,
            ready_replicas: 0,
            updated_replicas: 0,
            available_replicas: 0,
            message: "aucun Deployment".into(),
            pods,
        };
    };
    let desired = dep
        .pointer("/spec/replicas")
        .and_then(Value::as_i64)
        .unwrap_or(1);
    let generation = i(dep, &["metadata", "generation"]);
    let observed = i(dep, &["status", "observedGeneration"]);
    let ready = i(dep, &["status", "readyReplicas"]);
    let updated = i(dep, &["status", "updatedReplicas"]);
    let available = i(dep, &["status", "availableReplicas"]);
    let total = i(dep, &["status", "replicas"]);
    let image = dep
        .pointer("/spec/template/spec/containers")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(|c| s(c, &["image"]));
    let deadline_exceeded = dep
        .pointer("/status/conditions")
        .and_then(Value::as_array)
        .is_some_and(|a| {
            a.iter().any(|c| {
                c.get("type").and_then(Value::as_str) == Some("Progressing")
                    && c.get("reason").and_then(Value::as_str) == Some("ProgressDeadlineExceeded")
            })
        });
    // Même règle que `kubectl rollout status`.
    let rollout_complete =
        observed >= generation && updated >= desired && total <= updated && available >= desired;
    let pod_issue = pods.iter().find_map(|p| p.reason.clone());
    let (phase, message) = if desired == 0 {
        ("stopped", "arrêtée (0 réplica)".to_string())
    } else if deadline_exceeded {
        (
            "degraded",
            format!(
                "rollout bloqué (ProgressDeadlineExceeded){}",
                pod_issue.map(|r| format!(" — {r}")).unwrap_or_default()
            ),
        )
    } else if rollout_complete {
        ("running", format!("{ready}/{desired} prêts"))
    } else if pod_issue
        .as_deref()
        .is_some_and(|r| r.contains("BackOff") || r == "ErrImagePull" || r == "Error")
    {
        (
            "degraded",
            format!(
                "{ready}/{desired} prêts — {}",
                pod_issue.unwrap_or_default()
            ),
        )
    } else {
        (
            "progressing",
            format!("rollout en cours : {updated}/{desired} à jour, {available} disponibles"),
        )
    };
    AppStatus {
        name: name.into(),
        namespace: namespace.into(),
        phase: phase.into(),
        healthy: phase == "running",
        rollout_complete,
        image,
        replicas: desired,
        ready_replicas: ready,
        updated_replicas: updated,
        available_replicas: available,
        message,
        pods,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dep(desired: i64, gen: i64, obs: i64, upd: i64, avail: i64, total: i64) -> Value {
        json!({
            "metadata": { "generation": gen, "annotations": { "devforge.io/replicas": "3" } },
            "spec": { "replicas": desired, "template": { "spec": { "containers": [{ "image": "i:2" }] } } },
            "status": {
                "observedGeneration": obs, "updatedReplicas": upd, "availableReplicas": avail,
                "readyReplicas": avail, "replicas": total
            }
        })
    }

    #[test]
    fn absent_when_no_deployment() {
        let s = app_status("a", "ns", None, vec![]);
        assert_eq!(s.phase, "absent");
        assert!(!s.healthy);
    }

    #[test]
    fn running_when_rollout_complete() {
        let s = app_status("a", "ns", Some(&dep(2, 3, 3, 2, 2, 2)), vec![]);
        assert_eq!(s.phase, "running");
        assert!(s.rollout_complete && s.healthy);
        assert_eq!(s.image.as_deref(), Some("i:2"));
    }

    #[test]
    fn progressing_while_old_pods_remain() {
        let s = app_status("a", "ns", Some(&dep(2, 3, 3, 1, 2, 3)), vec![]);
        assert_eq!(s.phase, "progressing");
        assert!(!s.rollout_complete);
        let s = app_status("a", "ns", Some(&dep(2, 4, 3, 2, 2, 2)), vec![]);
        assert_eq!(s.phase, "progressing", "génération pas encore observée");
    }

    #[test]
    fn stopped_and_remembered_replicas() {
        let d = dep(0, 2, 2, 0, 0, 0);
        assert_eq!(app_status("a", "ns", Some(&d), vec![]).phase, "stopped");
        assert_eq!(remembered_replicas(&d), 3);
        assert_eq!(remembered_replicas(&json!({})), 1);
    }

    #[test]
    fn degraded_on_image_pull_backoff() {
        let pods = pods_from_list(&json!({ "items": [{
            "metadata": { "name": "a-1", "creationTimestamp": "2026-11-02T10:00:00Z" },
            "status": { "phase": "Pending", "containerStatuses": [{
                "name": "app", "ready": false, "restartCount": 0, "image": "i:2",
                "state": { "waiting": { "reason": "ImagePullBackOff" } }
            }]}
        }]}));
        assert_eq!(pods[0].reason.as_deref(), Some("ImagePullBackOff"));
        let s = app_status("a", "ns", Some(&dep(1, 1, 1, 1, 0, 1)), pods);
        assert_eq!(s.phase, "degraded");
        assert!(s.message.contains("ImagePullBackOff"));
    }

    #[test]
    fn pods_sorted_newest_first_and_unschedulable_reason() {
        let pods = pods_from_list(&json!({ "items": [
            { "metadata": { "name": "old", "creationTimestamp": "2026-11-01T00:00:00Z" },
              "status": { "phase": "Running", "containerStatuses": [{ "name": "app", "ready": true, "restartCount": 2 }] } },
            { "metadata": { "name": "new", "creationTimestamp": "2026-11-02T00:00:00Z" },
              "status": { "phase": "Pending", "conditions": [{ "type": "PodScheduled", "status": "False", "reason": "Unschedulable" }] } }
        ]}));
        assert_eq!(pods[0].name, "new");
        assert_eq!(pods[0].reason.as_deref(), Some("Unschedulable"));
        assert_eq!(pods[1].restarts, 2);
        assert!(pods[1].ready);
    }
}
