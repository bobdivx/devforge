use serde::{Deserialize, Serialize};

pub const DEFAULT_IMAGE: &str = "myoung34/github-runner:latest";
pub const DEFAULT_LABELS: &str = "self-hosted,devforge";
pub const DEFAULT_SERVER_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    Registration,
    Pat,
}

impl AuthMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Registration => "registration",
            Self::Pat => "pat",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "pat" => Self::Pat,
            _ => Self::Registration,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpStatus {
    Idle,
    Creating,
    Pulling,
    Starting,
    Recreating,
    Stopping,
    StartingAction,
    Restarting,
    Deleting,
    Failed,
}

impl OpStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Creating => "creating",
            Self::Pulling => "pulling",
            Self::Starting => "starting",
            Self::Recreating => "recreating",
            Self::Stopping => "stopping",
            Self::StartingAction => "starting_action",
            Self::Restarting => "restarting",
            Self::Deleting => "deleting",
            Self::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "creating" => Self::Creating,
            "pulling" => Self::Pulling,
            "starting" => Self::Starting,
            "recreating" => Self::Recreating,
            "stopping" => Self::Stopping,
            "starting_action" => Self::StartingAction,
            "restarting" => Self::Restarting,
            "deleting" => Self::Deleting,
            "failed" => Self::Failed,
            _ => Self::Idle,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedRunner {
    pub id: String,
    pub server_id: String,
    pub container_name: String,
    pub runner_name: String,
    pub owner: String,
    pub repo: String,
    pub repo_url: String,
    pub image: String,
    pub labels: String,
    pub network_mode: String,
    pub timezone: String,
    pub replace_existing: bool,
    pub pull_image: bool,
    pub volumes: Vec<String>,
    pub extra_env: Vec<EnvEntry>,
    pub auth_mode: String,
    pub enabled: bool,
    pub project_uuid: Option<String>,
    pub live_state: String,
    pub live_status: String,
    pub container_id: Option<String>,
    pub github_status: Option<String>,
    pub github_busy: Option<bool>,
    pub github_runner_id: Option<i64>,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
    pub op_status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRunnerRequest {
    pub owner: String,
    pub repo: String,
    pub runner_name: String,
    #[serde(default)]
    pub container_name: Option<String>,
    #[serde(default)]
    pub server_id: Option<String>,
    #[serde(default)]
    pub labels: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub network_mode: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub replace_existing: Option<bool>,
    #[serde(default)]
    pub pull_image: Option<bool>,
    #[serde(default)]
    pub volumes: Option<Vec<String>>,
    #[serde(default)]
    pub extra_env: Option<Vec<EnvEntry>>,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub project_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainerSnapshot {
    pub name: String,
    pub container_id: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub repo_url: Option<String>,
    pub runner_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunnerEvent {
    Updated { runner: ManagedRunner },
    Removed { id: String },
    SyncDone { count: usize },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogLine {
    pub cursor: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerLogs {
    pub available: bool,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub container: String,
    pub container_status: Option<String>,
    pub line_count: usize,
    pub items: Vec<LogLine>,
    pub runner_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerJob {
    pub run_id: u64,
    pub run_name: String,
    pub run_status: String,
    pub run_conclusion: Option<String>,
    pub run_url: String,
    pub job_id: Option<u64>,
    pub job_name: Option<String>,
    pub job_status: Option<String>,
    pub job_conclusion: Option<String>,
    pub runner_name: Option<String>,
}
