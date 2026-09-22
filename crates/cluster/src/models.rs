use serde::{Deserialize, Serialize};

pub const LEADER_NODE_ID: &str = "default";
pub const HEARTBEAT_STALE_SECS: i64 = 45;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeRole {
    Leader,
    Worker,
}

impl NodeRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Leader => "leader",
            Self::Worker => "worker",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "worker" => Self::Worker,
            _ => Self::Leader,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Online,
    Offline,
    Joining,
}

impl NodeStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Offline => "offline",
            Self::Joining => "joining",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "online" => Self::Online,
            "joining" => Self::Joining,
            _ => Self::Offline,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterNode {
    pub id: String,
    pub name: String,
    pub role: NodeRole,
    pub advertise_url: String,
    pub status: NodeStatus,
    pub os: String,
    pub arch: String,
    pub capabilities: Vec<String>,
    pub ssh_host: Option<String>,
    pub ssh_user: Option<String>,
    pub ssh_port: Option<u16>,
    pub last_seen_at: Option<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub drained: bool,
    #[serde(default)]
    pub ingress_host: String,
    #[serde(default)]
    pub metrics: NodeMetrics,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NodeMetrics {
    #[serde(default)]
    pub cpu_percent: Option<f64>,
    #[serde(default)]
    pub mem_used_bytes: Option<u64>,
    #[serde(default)]
    pub mem_total_bytes: Option<u64>,
    #[serde(default)]
    pub disk_used_bytes: Option<u64>,
    #[serde(default)]
    pub disk_total_bytes: Option<u64>,
    #[serde(default)]
    pub load_1: Option<f64>,
    #[serde(default)]
    pub docker_ok: Option<bool>,
    #[serde(default)]
    pub containers: Option<u32>,
    #[serde(default)]
    pub software_version: Option<String>,
    #[serde(default)]
    pub public_ip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinTokenRow {
    pub id: String,
    pub token_hash: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
    pub created_by: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedInvite {
    pub id: String,
    pub token: String,
    pub leader_url: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalClusterState {
    pub role: NodeRole,
    pub leader_url: String,
    pub node_id: String,
    pub node_secret: String,
    pub node_name: String,
    #[serde(default)]
    pub advertise_url: String,
    #[serde(default = "default_preferred_leader_id")]
    pub preferred_leader_id: String,
    #[serde(default)]
    pub preferred_leader_url: String,
    #[serde(default)]
    pub failover_secret: String,
    #[serde(default)]
    pub snapshot_generation: i64,
    #[serde(default)]
    pub acting_leader: bool,
    /// Terme du control plane. Une promotion l’incrémente. Un terme plus bas n’écrit plus.
    #[serde(default = "default_leader_term")]
    pub leader_term: i64,
    /// Vrai dès qu’un intérim plus récent a pris la main, jusqu’au redémarrage de reprise.
    #[serde(default)]
    pub writes_fenced: bool,
}

fn default_leader_term() -> i64 {
    1
}

fn default_preferred_leader_id() -> String {
    LEADER_NODE_ID.into()
}

impl Default for LocalClusterState {
    fn default() -> Self {
        Self {
            role: NodeRole::Leader,
            leader_url: String::new(),
            node_id: LEADER_NODE_ID.into(),
            node_secret: String::new(),
            node_name: "Leader".into(),
            advertise_url: String::new(),
            preferred_leader_id: LEADER_NODE_ID.into(),
            preferred_leader_url: String::new(),
            failover_secret: String::new(),
            snapshot_generation: 0,
            acting_leader: false,
            leader_term: 1,
            writes_fenced: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JoinRequest {
    pub token: String,
    pub name: String,
    #[serde(default)]
    pub advertise_url: String,
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub arch: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinResponse {
    pub ok: bool,
    pub node: ClusterNode,
    pub secret: String,
    pub leader_url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HeartbeatPayload {
    pub node_id: String,
    #[serde(default)]
    pub advertise_url: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub capabilities: Option<Vec<String>>,
    #[serde(default)]
    pub metrics: Option<NodeMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RosterEntry {
    pub id: String,
    pub name: String,
    pub role: NodeRole,
    pub advertise_url: String,
    #[serde(default)]
    pub drained: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HeartbeatAck {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub generation: i64,
    #[serde(default = "default_preferred_leader_id")]
    pub preferred_leader_id: String,
    #[serde(default)]
    pub preferred_leader_url: String,
    #[serde(default)]
    pub failover_secret: String,
    #[serde(default)]
    pub acting_leader: bool,
    #[serde(default)]
    pub acting_node_id: String,
    #[serde(default)]
    pub leader_term: i64,
    #[serde(default)]
    pub roster: Vec<RosterEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FailoverStatus {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub acting_leader: bool,
    #[serde(default)]
    pub node_id: String,
    #[serde(default)]
    pub advertise_url: String,
    #[serde(default = "default_preferred_leader_id")]
    pub preferred_leader_id: String,
    #[serde(default)]
    pub preferred_leader_url: String,
    #[serde(default)]
    pub generation: i64,
    #[serde(default)]
    pub leader_term: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddNodeRequest {
    pub name: String,
    pub host: String,
    #[serde(default = "default_ssh_user")]
    pub user: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default)]
    pub advertise_url: Option<String>,
}

fn default_ssh_user() -> String {
    "root".into()
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingJoin {
    pub leader_url: String,
    pub token: String,
    pub name: String,
    pub advertise_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecBody {
    #[serde(default)]
    pub workdir: String,
    pub command: String,
    #[serde(default)]
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterSummary {
    pub role: NodeRole,
    pub nodes: usize,
    pub online: usize,
}
