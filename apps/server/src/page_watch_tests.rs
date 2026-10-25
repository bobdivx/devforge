//! Tests P3 : surveillance de page (Postgres éphémère + serveur HTTP local).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;

use sqlx::PgPool;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::page_watch::*;
use crate::page_watch_routes::{apply_update, default_name, insert, validate_new, WatchBody};

const WS: &str = "ws-test";

fn local() -> FetchPolicy {
    FetchPolicy {
        timeout: Duration::from_secs(5),
        max_bytes: 64 * 1024,
        allow_loopback: true,
    }
}

async fn pool() -> PgPool {
    let pool = devforge_database::ephemeral_pg().await;
    crate::db::migrate(&pool).await.unwrap();
    pool
}

fn spec(kind: &str) -> WatchSpec {
    WatchSpec {
        kind: kind.into(),
        ..Default::default()
    }
}

async fn watch(pool: &PgPool, url: &str, s: WatchSpec) -> PageWatch {
    let s = s.normalized().unwrap();
    insert(pool, WS, "user-1", url, "Test", &s, 60)
        .await
        .unwrap()
}

/// Une vérification complète (bail + lecture + enregistrement) ; renvoie la surveillance relue.
async fn check(pool: &PgPool, uuid: &str, policy: &FetchPolicy) -> (Option<WatchCheck>, PageWatch) {
    let w = claim_one(pool, uuid, "test-instance")
        .await
        .unwrap()
        .expect("bail");
    let c = run_claimed(pool, &w, "test-instance", policy)
        .await
        .unwrap();
    (c, get(pool, WS, uuid).await.unwrap().unwrap())
}

async fn alert_count(pool: &PgPool, uuid: &str) -> i64 {
    let (n,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM page_watch_alerts WHERE watch_uuid = $1")
            .bind(uuid)
            .fetch_one(pool)
            .await
            .unwrap();
    n
}

async fn serve(server: &MockServer, body: &str) {
    server.reset().await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(body.to_string(), "text/html; charset=utf-8"),
        )
        .mount(server)
        .await;
}

// --- Migration ---------------------------------------------------------------------------

#[tokio::test]
async fn migration_is_idempotent() {
    let pool = pool().await;
    migrate(&pool).await.unwrap();
    migrate(&pool).await.unwrap();
    crate::db::migrate(&pool).await.unwrap();
    let w = watch(&pool, "https://exemple.fr/", spec("change")).await;
    assert_eq!(w.status, "active");
    assert_eq!(w.interval_minutes, 60);
}

// --- SSRF ----------------------------------------------------------------------------------

#[test]
fn forbidden_ip_ranges() {
    for ip in [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "169.254.169.254",
        "100.100.100.200",
        "0.0.0.0",
        "198.18.0.1",
        "224.0.0.1",
        "255.255.255.255",
        "192.0.0.170",
        "::1",
        "::",
        "fd00::1",
        "fc00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "64:ff9b::a9fe:a9fe",
        "2002:7f00:1::",
        "2001:db8::1",
        "ff02::1",
    ] {
        let ip: IpAddr = ip.parse().unwrap();
        assert!(ip_is_forbidden(ip), "{ip} doit être refusée");
    }
    for ip in [
        "1.1.1.1",
        "93.184.216.34",
        "2606:4700:4700::1111",
        "172.32.0.1",
        "100.128.0.1",
    ] {
        let ip: IpAddr = ip.parse().unwrap();
        assert!(!ip_is_forbidden(ip), "{ip} est publique");
    }
    assert!(ipv4_is_forbidden(Ipv4Addr::new(169, 254, 0, 1)));
    assert!(ipv6_is_forbidden(Ipv6Addr::LOCALHOST));
}

#[test]
fn url_validation_rejects_non_public_targets() {
    let p = FetchPolicy::default();
    for bad in [
        "file:///etc/passwd",
        "ftp://exemple.fr/",
        "gopher://exemple.fr/",
        "javascript:alert(1)",
        "http://user:secret@exemple.fr/",
        "http://localhost/",
        "http://api.localhost:8080/",
        "http://127.0.0.1:8080/",
        "http://2130706433/",
        "http://0x7f.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[fd00::1]/",
        "http://10.0.0.1/",
        "",
        "pas une adresse",
    ] {
        assert!(validate_url(bad, &p).is_err(), "{bad} doit être refusée");
    }
    assert!(validate_url("https://exemple.fr/produit?id=1", &p).is_ok());
    assert!(validate_url("http://93.184.216.34/", &p).is_ok());
}

#[tokio::test]
async fn dns_resolution_to_loopback_is_blocked() {
    let err = resolve_public("localhost", 80, &FetchPolicy::default())
        .await
        .unwrap_err();
    assert_eq!(err, BLOCKED_MESSAGE);
}

#[tokio::test]
async fn fetch_refuses_internal_literal_even_if_reachable() {
    let server = MockServer::start().await;
    serve(&server, "<p>secret</p>").await;
    // Serveur bien joignable, mais en loopback : refusé par la politique par défaut.
    let url = format!("{}/page", server.uri());
    let e = fetch(&url, &FetchPolicy::default()).await.unwrap_err();
    assert!(e.blocked);
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn redirect_to_metadata_or_private_is_blocked() {
    let server = MockServer::start().await;
    for (p, target) in [
        ("/meta", "http://169.254.169.254/latest/meta-data/"),
        ("/private", "http://10.0.0.5/admin"),
        ("/v6", "http://[::ffff:192.168.0.1]/"),
        ("/file", "file:///etc/passwd"),
        ("/host", "http://localhost./"),
    ] {
        Mock::given(method("GET"))
            .and(path(p))
            .respond_with(ResponseTemplate::new(302).insert_header("location", target))
            .mount(&server)
            .await;
    }
    let mut strict_loopback = local();
    strict_loopback.allow_loopback = true;
    for p in ["/meta", "/private", "/v6"] {
        let e = fetch(&format!("{}{p}", server.uri()), &strict_loopback)
            .await
            .unwrap_err();
        assert!(e.blocked, "{p} : {e:?}");
    }
    let e = fetch(&format!("{}/file", server.uri()), &strict_loopback)
        .await
        .unwrap_err();
    assert!(e.message.contains("http"), "{e:?}");
}

#[tokio::test]
async fn redirects_are_bounded_and_followed() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/loop"))
        .respond_with(ResponseTemplate::new(301).insert_header("location", "/loop"))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/a"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/page"))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("<p>ok</p>", "text/html"))
        .mount(&server)
        .await;
    let e = fetch(&format!("{}/loop", server.uri()), &local())
        .await
        .unwrap_err();
    assert!(e.message.contains("redirections"), "{e:?}");
    let f = fetch(&format!("{}/a", server.uri()), &local())
        .await
        .unwrap();
    assert!(f.body.contains("ok"));
}

#[tokio::test]
async fn size_time_and_type_limits() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/big"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("x".repeat(200_000), "text/html"))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/slow"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw("<p>lent</p>", "text/html")
                .set_delay(Duration::from_secs(3)),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/img"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(vec![0u8; 10], "image/png"))
        .mount(&server)
        .await;
    let e = fetch(&format!("{}/big", server.uri()), &local())
        .await
        .unwrap_err();
    assert!(e.message.contains("trop lourde"), "{e:?}");
    let mut quick = local();
    quick.timeout = Duration::from_millis(500);
    let started = std::time::Instant::now();
    let e = fetch(&format!("{}/slow", server.uri()), &quick)
        .await
        .unwrap_err();
    assert!(e.message.contains("trop de temps"), "{e:?}");
    assert!(started.elapsed() < Duration::from_secs(2));
    let e = fetch(&format!("{}/img", server.uri()), &local())
        .await
        .unwrap_err();
    assert!(e.message.contains("page web"), "{e:?}");
}

#[tokio::test]
async fn no_cookie_nor_credentials_forwarded() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/login"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("location", "/page")
                .insert_header("set-cookie", "session=abc; Path=/"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/page"))
        .respond_with(ResponseTemplate::new(200).set_body_raw("<p>ok</p>", "text/html"))
        .mount(&server)
        .await;
    fetch(&format!("{}/login", server.uri()), &local())
        .await
        .unwrap();
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs.len(), 2);
    for r in reqs {
        assert!(r.headers.get("cookie").is_none());
        assert!(r.headers.get("authorization").is_none());
        assert!(r.headers.get("proxy-authorization").is_none());
    }
}

#[tokio::test]
async fn create_rejects_private_targets() {
    let p = FetchPolicy::default();
    for url in [
        "http://127.0.0.1/",
        "http://localhost/",
        "http://169.254.169.254/",
        "file:///etc/passwd",
    ] {
        let body = WatchBody {
            url: Some(url.into()),
            ..Default::default()
        };
        assert!(validate_new(&body, &p).await.is_err(), "{url}");
    }
    assert_eq!(default_name("https://www.exemple.fr/a"), "exemple.fr");
}

// --- Normalisation / prix ------------------------------------------------------------------

#[test]
fn normalization_neutralizes_noise() {
    let a = page_lines(
        "<html><head><title>T</title><script>var t=1</script></head><body><p>Publié il y a 2 h</p>\
         <style>p{}</style><p>Prix   :  10 €</p><!-- c --><p>posted 5 minutes ago</p></body></html>",
    );
    let b = page_lines(
        "<html><head><title>T</title><script>var t=2</script></head><body><p>Publié il y a 3 heures</p>\
         <p>Prix : 10 €</p><p>posted 1 hour ago</p></body></html>",
    );
    assert_eq!(a, b);
    assert!(!a.iter().any(|l| l.contains("var t")));
    assert!(neutralize_relative("Mis à jour il y a 12 minutes").contains("il y a …"));
}

#[test]
fn price_parsing() {
    assert_eq!(parse_number("1 299,99"), Some(1299.99));
    assert_eq!(parse_number("1.299"), Some(1299.0));
    assert_eq!(parse_number("12.5"), Some(12.5));
    assert_eq!(parse_number("1,299.00"), Some(1299.0));
    assert_eq!(
        prices_in("Avant 129,99 € maintenant 89€90", "EUR"),
        vec![129.99, 89.90]
    );
    assert_eq!(prices_in("Only $19.99 today", "USD"), vec![19.99]);
    assert!(prices_in("19,99 €", "USD").is_empty());
    let html =
        r#"<script type="application/ld+json">{"price": "42.50", "priceCurrency": "EUR"}</script>"#;
    assert_eq!(structured_price(html, "EUR"), Some(42.5));
    assert_eq!(structured_price(html, "USD"), None);
    let text = "Accessoire 5 € · Produit principal : 249,00 €";
    assert_eq!(
        tracked_price("", text, "EUR", Some("produit principal")),
        Some(249.0)
    );
    assert_eq!(format_price(89.9, "EUR"), "89,90 €");
}

// --- Décision : backoff, pause, déduplication ----------------------------------------------

#[test]
fn backoff_is_exponential_and_capped() {
    assert_eq!(
        (1..=8).map(backoff_minutes).collect::<Vec<_>>(),
        vec![2, 4, 8, 16, 32, 60, 60, 60]
    );
}

#[tokio::test]
async fn failures_back_off_then_pause_once() {
    let pool = pool().await;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let w = watch(&pool, &format!("{}/page", server.uri()), spec("change")).await;
    for i in 1..=4 {
        let (c, w2) = check(&pool, &w.uuid, &local()).await;
        let c = c.unwrap();
        assert_eq!(c.outcome, "error");
        assert_eq!(c.http_status, Some(503));
        assert_eq!(w2.failure_streak, i);
        assert_eq!(w2.status, "active");
        let wait = (w2.next_check_at - w2.last_check_at.unwrap()).num_minutes();
        assert_eq!(wait, backoff_minutes(i));
        assert_eq!(alert_count(&pool, &w.uuid).await, 0);
    }
    let (_, w5) = check(&pool, &w.uuid, &local()).await;
    assert_eq!(w5.status, "paused");
    assert_eq!(w5.paused_reason.as_deref(), Some("failures"));
    assert_eq!(alert_count(&pool, &w.uuid).await, 1);
    // En pause : plus de bail possible, donc plus aucune vérification.
    assert!(claim_one(&pool, &w.uuid, "x").await.unwrap().is_none());
    // Reprise : compteur remis à zéro, vérification due tout de suite.
    assert!(resume(&pool, WS, &w.uuid).await.unwrap());
    let w6 = get(&pool, WS, &w.uuid).await.unwrap().unwrap();
    assert_eq!((w6.status.as_str(), w6.failure_streak), ("active", 0));
    assert!(w6.next_check_at <= chrono::Utc::now());
}

#[tokio::test]
async fn change_watch_baseline_then_dedup() {
    let pool = pool().await;
    let server = MockServer::start().await;
    serve(&server, "<p>Version 1</p><p>Mis à jour il y a 2 h</p>").await;
    let w = watch(&pool, &format!("{}/page", server.uri()), spec("change")).await;

    let (c, _) = check(&pool, &w.uuid, &local()).await;
    assert_eq!(c.unwrap().outcome, "baseline");
    // Seule la date relative bouge : rien.
    serve(&server, "<p>Version 1</p><p>Mis à jour il y a 3 h</p>").await;
    let (c, _) = check(&pool, &w.uuid, &local()).await;
    assert_eq!(c.unwrap().outcome, "unchanged");
    assert_eq!(alert_count(&pool, &w.uuid).await, 0);
    // Vrai changement : une alerte.
    serve(&server, "<p>Version 2</p><p>Mis à jour il y a 1 h</p>").await;
    let (c, w2) = check(&pool, &w.uuid, &local()).await;
    let c = c.unwrap();
    assert_eq!((c.outcome.as_str(), c.alerted), ("changed", true));
    assert!(w2.last_summary.unwrap().contains("Version 2"));
    // Même état : pas de nouvelle alerte.
    let (c, _) = check(&pool, &w.uuid, &local()).await;
    assert_eq!(c.unwrap().outcome, "unchanged");
    assert_eq!(alert_count(&pool, &w.uuid).await, 1);
    let checks = checks(&pool, &w.uuid, 10).await.unwrap();
    assert_eq!(checks.len(), 4);
}

#[tokio::test]
async fn text_watch_alerts_only_on_transition() {
    let pool = pool().await;
    let server = MockServer::start().await;
    let s = WatchSpec {
        kind: "text".into(),
        needle: Some("En stock".into()),
        ..Default::default()
    };
    let w = watch(&pool, &format!("{}/page", server.uri()), s).await;
    serve(&server, "<p>Rupture</p>").await;
    assert_eq!(
        check(&pool, &w.uuid, &local()).await.0.unwrap().outcome,
        "not_met"
    );
    serve(&server, "<p>EN   STOCK</p>").await;
    assert!(check(&pool, &w.uuid, &local()).await.0.unwrap().alerted);
    assert!(!check(&pool, &w.uuid, &local()).await.0.unwrap().alerted);
    serve(&server, "<p>Rupture</p>").await;
    check(&pool, &w.uuid, &local()).await;
    serve(&server, "<p>En stock</p>").await;
    assert!(check(&pool, &w.uuid, &local()).await.0.unwrap().alerted);
    assert_eq!(alert_count(&pool, &w.uuid).await, 2);
    assert_eq!(unread_count(&pool, WS).await.unwrap(), 2);
    let since = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
    let inbox = alerts_since(&pool, WS, &since).await;
    assert_eq!(inbox.len(), 2);
    let ev = crate::mobile_routes::watch_alert_event(&inbox[0].0, &inbox[0].1);
    assert!(ev.id.starts_with("watch:"));
    assert_eq!(ev.kind, "watch_alert");
    assert_eq!(mark_read(&pool, WS, None).await.unwrap(), 2);
    assert_eq!(unread_count(&pool, WS).await.unwrap(), 0);
}

#[tokio::test]
async fn price_watch_threshold() {
    let pool = pool().await;
    let server = MockServer::start().await;
    let s = WatchSpec {
        kind: "price".into(),
        threshold: Some(100.0),
        ..Default::default()
    };
    let w = watch(&pool, &format!("{}/page", server.uri()), s).await;
    serve(&server, "<p>Prix : 129,99 €</p>").await;
    let (c, w2) = check(&pool, &w.uuid, &local()).await;
    assert_eq!(c.unwrap().outcome, "not_met");
    assert_eq!(w2.last_value.as_deref(), Some("129,99 €"));
    serve(&server, "<p>Prix : 89,90 €</p>").await;
    let (c, w3) = check(&pool, &w.uuid, &local()).await;
    assert!(c.unwrap().alerted);
    assert!(w3.condition_met);
    assert!(!check(&pool, &w.uuid, &local()).await.0.unwrap().alerted);
    // Plus de prix sur la page : échec (pas une alerte).
    serve(&server, "<p>Indisponible</p>").await;
    let (c, w4) = check(&pool, &w.uuid, &local()).await;
    assert_eq!(c.unwrap().outcome, "error");
    assert_eq!(w4.failure_streak, 1);
    assert_eq!(alert_count(&pool, &w.uuid).await, 1);
}

// --- Bail / fencing -------------------------------------------------------------------------

#[tokio::test]
async fn lease_is_exclusive_and_fenced() {
    let pool = pool().await;
    let server = MockServer::start().await;
    serve(&server, "<p>A</p>").await;
    let w = watch(&pool, &format!("{}/page", server.uri()), spec("change")).await;

    let held = claim_one(&pool, &w.uuid, "i1").await.unwrap().unwrap();
    assert!(claim_one(&pool, &w.uuid, "i2").await.unwrap().is_none());
    assert!(claim_due(&pool, "i2", 10).await.unwrap().is_empty());

    // Pause pendant la vérification : le résultat est jeté.
    assert!(pause(&pool, WS, &w.uuid).await.unwrap());
    assert!(run_claimed(&pool, &held, "i1", &local())
        .await
        .unwrap()
        .is_none());
    // Reprise puis nouvelle prise de bail par la même instance : l'ancienne vérif reste muette.
    resume(&pool, WS, &w.uuid).await.unwrap();
    let fresh = claim_one(&pool, &w.uuid, "i1").await.unwrap().unwrap();
    assert!(run_claimed(&pool, &held, "i1", &local())
        .await
        .unwrap()
        .is_none());
    assert!(run_claimed(&pool, &fresh, "i1", &local())
        .await
        .unwrap()
        .is_some());
    assert_eq!(checks(&pool, &w.uuid, 10).await.unwrap().len(), 1);

    // Bail expiré (instance morte) : repris.
    sqlx::query("UPDATE page_watches SET lease_owner = 'dead', lease_until = now() - interval '1 second', next_check_at = now()")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(claim_due(&pool, "i3", 10).await.unwrap().len(), 1);
}

#[tokio::test]
async fn tick_checks_due_watches_once() {
    let pool = pool().await;
    let server = MockServer::start().await;
    serve(&server, "<p>A</p>").await;
    for _ in 0..3 {
        watch(&pool, &format!("{}/page", server.uri()), spec("change")).await;
    }
    let pol = local();
    let (a, b) = tokio::join!(tick(&pool, "i1", &pol), tick(&pool, "i2", &pol));
    assert_eq!(a + b, 3);
    assert_eq!(tick(&pool, "i1", &local()).await, 0, "plus rien de dû");
}

// --- Mise à jour / suppression -----------------------------------------------------------

#[tokio::test]
async fn update_resets_state_and_delete_cascades() {
    let pool = pool().await;
    let server = MockServer::start().await;
    serve(&server, "<p>A</p>").await;
    let w = watch(&pool, &format!("{}/page", server.uri()), spec("change")).await;
    check(&pool, &w.uuid, &local()).await;
    let w = get(&pool, WS, &w.uuid).await.unwrap().unwrap();
    assert!(w.last_hash.is_some());

    // Le nom seul : l'état est gardé.
    let body = WatchBody {
        name: Some("Renommée".into()),
        ..Default::default()
    };
    let w2 = apply_update(&pool, WS, &w, &body, &local())
        .await
        .ok()
        .unwrap();
    assert_eq!(w2.name, "Renommée");
    assert!(w2.last_hash.is_some());
    // La condition : nouvelle référence.
    let body = WatchBody {
        kind: Some("text".into()),
        text: Some("Promo".into()),
        ..Default::default()
    };
    let w3 = apply_update(&pool, WS, &w2, &body, &local())
        .await
        .ok()
        .unwrap();
    assert_eq!(w3.kind, "text");
    assert!(w3.last_hash.is_none());
    // Une adresse interne est refusée en modification aussi.
    let body = WatchBody {
        url: Some("http://169.254.169.254/".into()),
        ..Default::default()
    };
    assert!(apply_update(&pool, WS, &w3, &body, &local()).await.is_err());
    // Autre espace : invisible.
    assert!(get(&pool, "autre", &w.uuid).await.unwrap().is_none());
    assert!(!delete(&pool, "autre", &w.uuid).await.unwrap());
    assert!(delete(&pool, WS, &w.uuid).await.unwrap());
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM page_watch_checks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn spec_defaults_and_errors() {
    let s = spec("").normalized().unwrap();
    assert_eq!(s.kind, "change");
    let s = WatchSpec {
        kind: "price".into(),
        threshold: Some(10.0),
        ..Default::default()
    }
    .normalized()
    .unwrap();
    assert_eq!(
        (s.price_op.as_deref(), s.currency.as_deref()),
        (Some("below"), Some("EUR"))
    );
    assert!(spec("text").normalized().is_err());
    assert!(spec("price").normalized().is_err());
    assert!(spec("autre").normalized().is_err());
    assert!(normalize_interval(Some(1)).is_err());
    assert_eq!(normalize_interval(None), Ok(60));
}
