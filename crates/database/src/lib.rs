use serde_json::{json, Value};
use uuid::Uuid;

/// Provisioning DB applicative — pas encore branché sur un moteur réel.
pub struct DatabaseFacade;

impl DatabaseFacade {
    pub fn new() -> Self {
        Self
    }

    pub fn status(&self, database_uuid: &str) -> Value {
        json!({
            "ok": false,
            "uuid": database_uuid,
            "error": "Provisioning DB non implémenté — pas de simulation"
        })
    }

    pub fn provision(&self, name: &str, _engine: Option<&str>) -> Value {
        let name = name.trim();
        if name.is_empty() {
            return json!({ "ok": false, "error": "name requis" });
        }
        let _ = Uuid::new_v4();
        json!({
            "ok": false,
            "error": format!("Provisioning DB « {name} » non implémenté — pas de simulation")
        })
    }
}

impl Default for DatabaseFacade {
    fn default() -> Self {
        Self::new()
    }
}
