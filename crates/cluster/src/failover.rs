//! Élection d’un worker intérimaire si le leader préféré est injoignable.

use crate::models::{NodeRole, RosterEntry};

/// Heartbeats manqués avant d’élire un intérim (15 s × 4 ≈ 1 min).
pub const FAILOVER_FAIL_STREAK: u32 = 4;

/// Parmi les workers joignables (URL, pas drainés), le plus petit `id` gagne.
pub fn pick_failover_winner<'a>(candidates: &'a [RosterEntry]) -> Option<&'a RosterEntry> {
    candidates
        .iter()
        .filter(|n| n.role == NodeRole::Worker)
        .filter(|n| !n.drained)
        .filter(|n| !n.advertise_url.trim().is_empty())
        .min_by_key(|n| n.id.as_str())
}

pub fn i_am_failover_winner(my_id: &str, candidates: &[RosterEntry]) -> bool {
    pick_failover_winner(candidates).is_some_and(|w| w.id == my_id)
}

/// Un autre nœud est l’écrivain. On cède si son terme est inconnu, égal ou plus haut.
pub fn must_yield_to_interim(
    my_id: &str,
    my_term: i64,
    remote_id: &str,
    remote_acting: bool,
    remote_term: i64,
) -> bool {
    if !remote_acting || remote_id.is_empty() || remote_id == my_id {
        return false;
    }
    remote_term == 0 || remote_term >= my_term
}

/// Workers à essayer avant soi (ids plus petits) — s’ils sont déjà intérim, on les suit.
pub fn earlier_candidates<'a>(my_id: &str, candidates: &'a [RosterEntry]) -> Vec<&'a RosterEntry> {
    let mut v: Vec<_> = candidates
        .iter()
        .filter(|n| n.role == NodeRole::Worker)
        .filter(|n| !n.drained)
        .filter(|n| !n.advertise_url.trim().is_empty())
        .filter(|n| n.id.as_str() < my_id)
        .collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(id: &str, url: &str, drained: bool) -> RosterEntry {
        RosterEntry {
            id: id.into(),
            name: id.into(),
            role: NodeRole::Worker,
            advertise_url: url.into(),
            drained,
        }
    }

    #[test]
    fn smallest_id_wins() {
        let c = vec![
            w("node_bbb", "http://b:8000", false),
            w("node_aaa", "http://a:8000", false),
        ];
        assert_eq!(pick_failover_winner(&c).unwrap().id, "node_aaa");
        assert!(i_am_failover_winner("node_aaa", &c));
        assert!(!i_am_failover_winner("node_bbb", &c));
    }

    #[test]
    fn drained_and_empty_url_skipped() {
        let c = vec![
            w("node_aaa", "", false),
            w("node_bbb", "http://b:8000", true),
            w("node_ccc", "http://c:8000", false),
        ];
        assert_eq!(pick_failover_winner(&c).unwrap().id, "node_ccc");
    }

    #[test]
    fn yield_when_interim_term_is_newer_or_unknown() {
        assert!(must_yield_to_interim("default", 1, "node_a", true, 2));
        assert!(must_yield_to_interim("default", 2, "node_a", true, 2));
        assert!(must_yield_to_interim("default", 3, "node_a", true, 0));
        assert!(!must_yield_to_interim("default", 3, "node_a", true, 2));
        assert!(!must_yield_to_interim("default", 1, "default", true, 9));
        assert!(!must_yield_to_interim("default", 1, "node_a", false, 9));
    }

    #[test]
    fn earlier_are_sorted() {
        let c = vec![
            w("node_c", "http://c:8000", false),
            w("node_a", "http://a:8000", false),
            w("node_b", "http://b:8000", false),
        ];
        let e = earlier_candidates("node_c", &c);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].id, "node_a");
        assert_eq!(e[1].id, "node_b");
    }
}
