//! Cluster DevForge : nœuds, invitations UX, executor HTTP.

mod client;
mod crypto;
mod executor;
mod facade;
mod failover;
mod metrics;
mod models;
mod placement;
mod store;

pub use client::{
    clear_pending_join, data_dir, failover_identity_path, load_pending_join, normalize_api_base,
    pending_join_path, promote_flag_path, reclaim_flag_path, restart_current_process, roster_path,
    snapshot_path, write_pending_join_sync, LeaderClient,
};
pub use crypto::{
    extract_join_token, format_join_code, hash_secret, new_join_token, new_node_id, new_node_secret,
    parse_join_invite,
};
pub use executor::ClusterAwareExecutor;
pub use facade::{bootstrap_script, ClusterFacade};
pub use failover::{
    earlier_candidates, i_am_failover_winner, must_yield_to_interim, pick_failover_winner,
    FAILOVER_FAIL_STREAK,
};
pub use metrics::{collect_node_metrics, diagnostic_command};
pub use models::*;
pub use placement::{
    is_loopback_advertise_url, nodes_to_evacuate, pick_placement, replication_peers, score_node,
    validate_worker_advertise_url, PlacementWeights,
};
pub use store::{ClusterStore, MemoryClusterStore};
