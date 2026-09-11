//! GitHub Actions self-hosted runners — desired state, Docker orchestration, live snapshot.

mod compat;
mod docker;
mod events;
mod facade;
mod models;
mod store;
mod sync;

pub use compat::{
    is_compatible, parse_version, with_compatible_extra_env, DEFAULT_RUNNER_VERSION,
    MIN_RUNNER_VERSION,
};
pub use docker::{
    assert_safe_volume_mount, assert_valid_container_name, build_docker_run_command,
    discovery_command, parse_docker_ps_json_lines, slugify_runner_name,
};
pub use events::RunnerEventBus;
pub use facade::RunnerFacade;
pub use models::*;
pub use store::{
    decode_extra_env, decode_volumes, encode_extra_env, encode_volumes, MemoryRunnerStore,
    RunnerStore,
};
pub use sync::RunnerSyncWorker;
