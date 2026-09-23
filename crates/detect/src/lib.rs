//! Framework / stack detection from a repository file tree.
//! Used to configure build_pack, port, static, test_command, etc.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};

/// Snapshot of a repo: path → optional file content (None = exists only).
pub type FileTree = HashMap<String, Option<String>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FrameworkKind {
    DockerCompose,
    Dockerfile,
    Laravel,
    NextJs,
    Nuxt,
    Remix,
    Astro,
    ViteStatic,
    NestJs,
    Express,
    Node,
    Rust,
    Go,
    Python,
    Ruby,
    Php,
    StaticHtml,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    pub framework: FrameworkKind,
    pub label: String,
    pub confidence: f32,
    pub build_pack: String,
    pub port: u16,
    pub is_static: bool,
    pub publish_directory: Option<String>,
    pub base_directory: String,
    pub docker_compose_location: Option<String>,
    pub test_command: Option<String>,
    pub hints: Vec<String>,
    pub evidence: Vec<String>,
}

impl DetectionResult {
    pub fn unknown() -> Self {
        Self {
            framework: FrameworkKind::Unknown,
            label: "Inconnu".into(),
            confidence: 0.2,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: None,
            hints: vec!["Aucun framework clair — nixpacks par défaut".into()],
            evidence: vec![],
        }
    }
}

fn norm_path(p: &str) -> String {
    p.trim().trim_start_matches("./").replace('\\', "/")
}

fn has_file(tree: &FileTree, name: &str) -> bool {
    let n = name.to_lowercase();
    tree.keys().any(|k| {
        let k = norm_path(k);
        k.eq_ignore_ascii_case(name)
            || k.ends_with(&format!("/{n}"))
            || k.to_lowercase() == n
    })
}

fn find_content<'a>(tree: &'a FileTree, name: &str) -> Option<&'a str> {
    let n = name.to_lowercase();
    tree.iter().find_map(|(k, v)| {
        let k = norm_path(k);
        if k.eq_ignore_ascii_case(name) || k.ends_with(&format!("/{n}")) || k.to_lowercase() == n {
            v.as_deref()
        } else {
            None
        }
    })
}

fn parse_json(content: &str) -> Option<Value> {
    serde_json::from_str(content).ok()
}

/// Last `EXPOSE <port>` wins (common pattern: build stages then runtime EXPOSE).
fn parse_dockerfile_expose(dockerfile: &str) -> Option<u16> {
    let mut found = None;
    for line in dockerfile.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let upper = t.to_ascii_uppercase();
        if let Some(rest) = upper.strip_prefix("EXPOSE ") {
            let port_str = rest
                .split_whitespace()
                .next()
                .unwrap_or("")
                .split('/')
                .next()
                .unwrap_or("");
            if let Ok(p) = port_str.parse::<u16>() {
                if p > 0 {
                    found = Some(p);
                }
            }
        }
    }
    found
}

/// Detect framework from an in-memory file tree.
pub fn detect(tree: &FileTree) -> DetectionResult {
    let mut result = detect_inner(tree);
    apply_listen_port(&mut result, tree);
    result
}

fn detect_inner(tree: &FileTree) -> DetectionResult {
    let names: BTreeSet<String> = tree.keys().map(|k| norm_path(k).to_lowercase()).collect();
    let mut evidence = Vec::new();

    // 1) Docker compose
    for compose in [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ] {
        if has_file(tree, compose) {
            evidence.push(compose.into());
            return DetectionResult {
                framework: FrameworkKind::DockerCompose,
                label: "Docker Compose".into(),
                confidence: 0.95,
                build_pack: "dockercompose".into(),
                port: 80,
                is_static: false,
                publish_directory: None,
                base_directory: "/".into(),
                docker_compose_location: Some(format!("/{compose}")),
                test_command: None,
                hints: vec!["Stack multi-services détectée".into()],
                evidence,
            };
        }
    }

    // 2) Dockerfile (alone)
    if has_file(tree, "Dockerfile") {
        evidence.push("Dockerfile".into());
        // Still refine port from package.json if present
        let mut port = 3000u16;
        let mut test_command = None;
        let mut label = "Dockerfile".to_string();
        let mut framework = FrameworkKind::Dockerfile;
        if let Some(pkg) = find_content(tree, "package.json").and_then(parse_json) {
            let node = detect_node(&pkg, &mut evidence);
            port = node.port;
            test_command = node.test_command;
            if node.framework != FrameworkKind::Node && node.framework != FrameworkKind::Unknown {
                label = format!("{} + Dockerfile", node.label);
                framework = node.framework;
            }
        }
        if let Some(df) = find_content(tree, "Dockerfile") {
            if let Some(ex) = parse_dockerfile_expose(df) {
                evidence.push(format!("EXPOSE {ex}"));
                port = ex;
            }
        }
        return DetectionResult {
            framework,
            label,
            confidence: 0.9,
            build_pack: "dockerfile".into(),
            port,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command,
            hints: vec!["Build via Dockerfile".into()],
            evidence,
        };
    }

    // 3) PHP / Laravel
    if has_file(tree, "composer.json") {
        evidence.push("composer.json".into());
        let composer = find_content(tree, "composer.json").and_then(parse_json);
        let is_laravel = composer
            .as_ref()
            .and_then(|c| c.pointer("/require/laravel/framework"))
            .is_some()
            || has_file(tree, "artisan");
        if is_laravel {
            if has_file(tree, "artisan") {
                evidence.push("artisan".into());
            }
            return DetectionResult {
                framework: FrameworkKind::Laravel,
                label: "Laravel".into(),
                confidence: 0.92,
                build_pack: "nixpacks".into(),
                port: 8000,
                is_static: false,
                publish_directory: None,
                base_directory: "/".into(),
                docker_compose_location: None,
                test_command: Some(
                    if has_file(tree, "vendor/bin/pest") || names.iter().any(|n| n.contains("pest"))
                    {
                        "./vendor/bin/pest --compact".into()
                    } else {
                        "php artisan test".into()
                    },
                ),
                hints: vec![
                    "Laravel détecté — port 8000".into(),
                    "Prévoir DB + env APP_KEY".into(),
                ],
                evidence,
            };
        }
        return DetectionResult {
            framework: FrameworkKind::Php,
            label: "PHP".into(),
            confidence: 0.75,
            build_pack: "nixpacks".into(),
            port: 8080,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: Some("composer test".into()),
            hints: vec!["Projet PHP (Composer)".into()],
            evidence,
        };
    }

    // 4) Node ecosystem
    if has_file(tree, "package.json") {
        evidence.push("package.json".into());
        if let Some(pkg) = find_content(tree, "package.json").and_then(parse_json) {
            let node = detect_node(&pkg, &mut evidence);
            return DetectionResult {
                framework: node.framework,
                label: node.label,
                confidence: node.confidence,
                build_pack: node.build_pack,
                port: node.port,
                is_static: node.is_static,
                publish_directory: node.publish_directory,
                base_directory: "/".into(),
                docker_compose_location: None,
                test_command: node.test_command,
                hints: node.hints,
                evidence,
            };
        }
    }

    // 5) Rust
    if has_file(tree, "Cargo.toml") {
        evidence.push("Cargo.toml".into());
        return DetectionResult {
            framework: FrameworkKind::Rust,
            label: "Rust".into(),
            confidence: 0.88,
            build_pack: "nixpacks".into(),
            port: 8000,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: Some("cargo test".into()),
            hints: vec!["Cargo.toml détecté".into()],
            evidence,
        };
    }

    // 6) Go
    if has_file(tree, "go.mod") {
        evidence.push("go.mod".into());
        return DetectionResult {
            framework: FrameworkKind::Go,
            label: "Go".into(),
            confidence: 0.88,
            build_pack: "nixpacks".into(),
            port: 8080,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: Some("go test ./...".into()),
            hints: vec!["go.mod détecté".into()],
            evidence,
        };
    }

    // 7) Python
    if has_file(tree, "pyproject.toml")
        || has_file(tree, "requirements.txt")
        || has_file(tree, "Pipfile")
    {
        if has_file(tree, "pyproject.toml") {
            evidence.push("pyproject.toml".into());
        }
        if has_file(tree, "requirements.txt") {
            evidence.push("requirements.txt".into());
        }
        return DetectionResult {
            framework: FrameworkKind::Python,
            label: "Python".into(),
            confidence: 0.85,
            build_pack: "nixpacks".into(),
            port: 8000,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: Some("pytest".into()),
            hints: vec!["Projet Python détecté".into()],
            evidence,
        };
    }

    // 8) Ruby
    if has_file(tree, "Gemfile") {
        evidence.push("Gemfile".into());
        return DetectionResult {
            framework: FrameworkKind::Ruby,
            label: "Ruby".into(),
            confidence: 0.85,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: Some("bundle exec rspec".into()),
            hints: vec!["Gemfile détecté".into()],
            evidence,
        };
    }

    // 9) Static HTML
    if has_file(tree, "index.html") {
        evidence.push("index.html".into());
        return DetectionResult {
            framework: FrameworkKind::StaticHtml,
            label: "Static HTML".into(),
            confidence: 0.7,
            build_pack: "static".into(),
            port: 80,
            is_static: true,
            publish_directory: Some("/".into()),
            base_directory: "/".into(),
            docker_compose_location: None,
            test_command: None,
            hints: vec!["Site statique (index.html)".into()],
            evidence,
        };
    }

    DetectionResult::unknown()
}

struct NodeHit {
    framework: FrameworkKind,
    label: String,
    confidence: f32,
    build_pack: String,
    port: u16,
    is_static: bool,
    publish_directory: Option<String>,
    test_command: Option<String>,
    hints: Vec<String>,
}

fn dep_has(pkg: &Value, name: &str) -> bool {
    // Use object key lookup — JSON Pointer breaks on scoped packages (`@astrojs/node`).
    pkg.get("dependencies")
        .and_then(|d| d.get(name))
        .is_some()
        || pkg
            .get("devDependencies")
            .and_then(|d| d.get(name))
            .is_some()
}

fn has_script(pkg: &Value, name: &str) -> bool {
    pkg.get("scripts")
        .and_then(|s| s.get(name))
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
}

fn is_server_dep(pkg: &Value) -> bool {
    const NAMES: &[&str] = &[
        "express",
        "fastify",
        "koa",
        "hono",
        "@hono/node-server",
        "elysia",
        "polka",
        "restify",
        "@hapi/hapi",
        "hapi",
        "@nestjs/core",
        "@adonisjs/core",
        "@strapi/strapi",
    ];
    NAMES.iter().any(|n| dep_has(pkg, n))
}

/// Hints for a long-running Node server (API), including the no-build case.
fn server_runtime_hints(pkg: &Value, base: &str) -> Vec<String> {
    let mut hints = vec![base.to_string()];
    if has_script(pkg, "start") && !has_script(pkg, "build") {
        hints.push(
            "Pas de script build — le déploiement démarre l’app directement (npm start).".into(),
        );
    } else if has_script(pkg, "start") {
        hints.push("Script build présent — compilation puis npm start.".into());
    } else {
        hints.push(
            "Pas de script start — ajoute \"start\" dans package.json (ex. node server.js)."
                .into(),
        );
    }
    hints
}

fn parse_port_digits(s: &str) -> Option<u16> {
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    let port = digits.parse::<u16>().ok()?;
    if port == 0 { None } else { Some(port) }
}

fn port_after_key(text: &str, key: &str) -> Option<u16> {
    let pattern = format!("{key}=");
    let mut start = 0;
    while let Some(rel) = text[start..].find(&pattern) {
        let i = start + rel;
        let boundary_ok = i == 0
            || !text[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if boundary_ok {
            let rest = &text[i + pattern.len()..];
            let rest = rest.trim_start_matches(['"', '\'']);
            if let Some(port) = parse_port_digits(rest) {
                return Some(port);
            }
        }
        start = i + pattern.len();
    }
    None
}

fn port_from_command(cmd: &str) -> Option<u16> {
    if let Some(port) = port_after_key(cmd, "PORT") {
        return Some(port);
    }
    for flag in ["--port=", "--port "] {
        if let Some(i) = cmd.find(flag) {
            let rest = cmd[i + flag.len()..].trim_start();
            if let Some(port) = parse_port_digits(rest) {
                return Some(port);
            }
        }
    }
    None
}

fn port_from_package(pkg: &Value) -> Option<u16> {
    let scripts = pkg.get("scripts")?.as_object()?;
    for val in scripts.values() {
        let cmd = val.as_str()?;
        if let Some(port) = port_from_command(cmd) {
            return Some(port);
        }
    }
    None
}

fn port_from_env_body(body: &str) -> Option<u16> {
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let t = t.strip_prefix("export ").unwrap_or(t);
        if let Some(port) = port_after_key(t, "PORT").or_else(|| port_after_key(t, "APP_PORT")) {
            return Some(port);
        }
    }
    None
}

fn apply_listen_port(result: &mut DetectionResult, tree: &FileTree) {
    if result.is_static {
        return;
    }
    let from_pkg = find_content(tree, "package.json")
        .and_then(parse_json)
        .as_ref()
        .and_then(port_from_package);
    let from_env = [".env.example", ".env.sample", ".env.template"]
        .iter()
        .find_map(|name| find_content(tree, name).and_then(port_from_env_body));
    let Some(port) = from_pkg.or(from_env) else {
        return;
    };
    if port != result.port {
        result
            .hints
            .push(format!("Port {port} lu depuis la config du repo"));
        result.evidence.push(format!("port:{port}"));
    }
    result.port = port;
}

fn detect_node(pkg: &Value, evidence: &mut Vec<String>) -> NodeHit {
    let test_command = Some("npm test --if-present".into());

    if dep_has(pkg, "next") {
        evidence.push("dep:next".into());
        return NodeHit {
            framework: FrameworkKind::NextJs,
            label: "Next.js".into(),
            confidence: 0.93,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            test_command,
            hints: vec!["Next.js — port 3000".into()],
        };
    }
    if dep_has(pkg, "nuxt") || dep_has(pkg, "nuxt3") {
        evidence.push("dep:nuxt".into());
        return NodeHit {
            framework: FrameworkKind::Nuxt,
            label: "Nuxt".into(),
            confidence: 0.92,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            test_command,
            hints: vec!["Nuxt — port 3000".into()],
        };
    }
    if dep_has(pkg, "@remix-run/react") || dep_has(pkg, "@remix-run/node") {
        evidence.push("dep:remix".into());
        return NodeHit {
            framework: FrameworkKind::Remix,
            label: "Remix".into(),
            confidence: 0.9,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            test_command,
            hints: vec!["Remix détecté".into()],
        };
    }
    if dep_has(pkg, "astro") {
        evidence.push("dep:astro".into());
        let is_static = !dep_has(pkg, "@astrojs/node") && !dep_has(pkg, "@astrojs/vercel");
        return NodeHit {
            framework: FrameworkKind::Astro,
            label: "Astro".into(),
            confidence: 0.9,
            build_pack: if is_static {
                "static".into()
            } else {
                "nixpacks".into()
            },
            port: if is_static { 80 } else { 4321 },
            is_static,
            publish_directory: if is_static {
                Some("/dist".into())
            } else {
                None
            },
            test_command,
            hints: vec![if is_static {
                "Astro static → publish /dist".into()
            } else {
                "Astro SSR — port 4321".into()
            }],
        };
    }
    if dep_has(pkg, "@nestjs/core") {
        evidence.push("dep:nestjs".into());
        return NodeHit {
            framework: FrameworkKind::NestJs,
            label: "NestJS".into(),
            confidence: 0.9,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            test_command,
            hints: server_runtime_hints(pkg, "NestJS — serveur, port 3000 par défaut"),
        };
    }
    if is_server_dep(pkg) {
        evidence.push("dep:http-server".into());
        return NodeHit {
            framework: FrameworkKind::Express,
            label: "Node HTTP".into(),
            confidence: 0.85,
            build_pack: "nixpacks".into(),
            port: 3000,
            is_static: false,
            publish_directory: None,
            test_command,
            hints: server_runtime_hints(
                pkg,
                "Serveur Node (Express, Fastify, Hono…) — pas un site statique",
            ),
        };
    }
    if dep_has(pkg, "vite") || dep_has(pkg, "react-scripts") || dep_has(pkg, "vue") {
        evidence.push("dep:frontend".into());
        return NodeHit {
            framework: FrameworkKind::ViteStatic,
            label: "Frontend (Vite/React/Vue)".into(),
            confidence: 0.82,
            build_pack: "static".into(),
            port: 80,
            is_static: true,
            publish_directory: Some("/dist".into()),
            test_command,
            hints: vec!["SPA/static — publish /dist, port 80".into()],
        };
    }

    let serverish = has_script(pkg, "start") && !has_script(pkg, "build");
    NodeHit {
        framework: FrameworkKind::Node,
        label: if has_script(pkg, "start") {
            "Node.js (API)".into()
        } else {
            "Node.js".into()
        },
        confidence: if serverish { 0.8 } else { 0.7 },
        build_pack: "nixpacks".into(),
        port: 3000,
        is_static: false,
        publish_directory: None,
        test_command,
        hints: if has_script(pkg, "start") || serverish {
            server_runtime_hints(pkg, "package.json serveur — nixpacks")
        } else {
            vec!["package.json générique — nixpacks".into()]
        },
    }
}

/// Build a FileTree from directory listing (names only) + optional contents map.
pub fn tree_from_names(names: &[String], contents: HashMap<String, String>) -> FileTree {
    let mut tree = FileTree::new();
    for n in names {
        let key = norm_path(n);
        let content = contents.get(&key).cloned().or_else(|| {
            contents.iter().find_map(|(k, v)| {
                if norm_path(k).eq_ignore_ascii_case(&key) {
                    Some(v.clone())
                } else {
                    None
                }
            })
        });
        tree.insert(key, content);
    }
    for (k, v) in contents {
        tree.entry(norm_path(&k)).or_insert(Some(v));
    }
    tree
}

/// Scan a local directory (non-recursive root + one level for monorepos light).
pub fn scan_local_dir(root: &std::path::Path) -> FileTree {
    let mut tree = FileTree::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return tree;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".env.example" {
            continue;
        }
        let path = entry.path();
        if path.is_file() {
            let content = std::fs::read_to_string(&path).ok();
            // Cap large files
            let content = content.and_then(|c| {
                if c.len() > 200_000 {
                    None
                } else {
                    Some(c)
                }
            });
            tree.insert(name, content);
        } else if path.is_dir() {
            // Record interesting nested markers without full recursion
            for marker in [
                "package.json",
                "composer.json",
                "Cargo.toml",
                "Dockerfile",
                "docker-compose.yml",
                "go.mod",
            ] {
                let nested = path.join(marker);
                if nested.is_file() {
                    let rel = format!("{name}/{marker}");
                    let content = std::fs::read_to_string(&nested).ok();
                    tree.insert(rel, content);
                }
            }
        }
    }
    tree
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_laravel() {
        let mut tree = FileTree::new();
        tree.insert(
            "composer.json".into(),
            Some(r#"{"require":{"laravel/framework":"^11.0"}}"#.into()),
        );
        tree.insert("artisan".into(), Some("#!/usr/bin/env php".into()));
        let d = detect(&tree);
        assert_eq!(d.framework, FrameworkKind::Laravel);
        assert_eq!(d.port, 8000);
        assert_eq!(d.build_pack, "nixpacks");
    }

    #[test]
    fn detects_next() {
        let mut tree = FileTree::new();
        tree.insert(
            "package.json".into(),
            Some(r#"{"dependencies":{"next":"14.0.0"}}"#.into()),
        );
        let d = detect(&tree);
        assert_eq!(d.framework, FrameworkKind::NextJs);
        assert_eq!(d.port, 3000);
    }

    #[test]
    fn detects_compose() {
        let mut tree = FileTree::new();
        tree.insert("docker-compose.yml".into(), Some("services:\n  web:\n".into()));
        let d = detect(&tree);
        assert_eq!(d.framework, FrameworkKind::DockerCompose);
        assert_eq!(d.build_pack, "dockercompose");
    }

    #[test]
    fn detects_vite_static() {
        let mut tree = FileTree::new();
        tree.insert(
            "package.json".into(),
            Some(r#"{"devDependencies":{"vite":"^5.0.0"}}"#.into()),
        );
        let d = detect(&tree);
        assert!(d.is_static);
        assert_eq!(d.build_pack, "static");
        assert_eq!(d.publish_directory.as_deref(), Some("/dist"));
    }

    #[test]
    fn detects_astro_ssr_scoped_adapter() {
        let mut tree = FileTree::new();
        tree.insert(
            "package.json".into(),
            Some(r#"{"dependencies":{"astro":"^7.0.0","@astrojs/node":"^11.0.0"}}"#.into()),
        );
        let d = detect(&tree);
        assert!(!d.is_static, "scoped @astrojs/node must not be treated as static");
        assert_eq!(d.build_pack, "nixpacks");
        assert_eq!(d.port, 4321);
    }

    #[test]
    fn detects_astro_dockerfile_expose() {
        let mut tree = FileTree::new();
        tree.insert(
            "package.json".into(),
            Some(r#"{"dependencies":{"astro":"^7.0.0","@astrojs/node":"^11.0.0"}}"#.into()),
        );
        tree.insert(
            "Dockerfile".into(),
            Some("FROM node\nEXPOSE 4321\nCMD node dist/server/entry.mjs\n".into()),
        );
        let d = detect(&tree);
        assert_eq!(d.build_pack, "dockerfile");
        assert_eq!(d.port, 4321);
        assert!(d.label.contains("Astro"));
    }

    #[test]
    fn detects_express_api_without_build_script() {
        let mut tree = FileTree::new();
        tree.insert(
            "package.json".into(),
            Some(
                r#"{"dependencies":{"express":"^4.18.0"},"scripts":{"start":"node server.js"}}"#
                    .into(),
            ),
        );
        tree.insert(".env.example".into(), Some("PORT=8080\nDATABASE_URL=postgres\n".into()));
        let d = detect(&tree);
        assert_eq!(d.framework, FrameworkKind::Express);
        assert!(!d.is_static);
        assert_eq!(d.build_pack, "nixpacks");
        assert_eq!(d.port, 8080);
        assert!(d.hints.iter().any(|h| h.contains("Pas de script build")));
    }

    #[test]
    fn detects_plain_node_start_without_marking_static() {
        let mut tree = FileTree::new();
        tree.insert(
            "package.json".into(),
            Some(r#"{"scripts":{"start":"node index.js","dev":"node --watch index.js"}}"#.into()),
        );
        let d = detect(&tree);
        assert_eq!(d.framework, FrameworkKind::Node);
        assert!(!d.is_static);
        assert!(d.label.contains("API"));
        assert!(d.hints.iter().any(|h| h.contains("Pas de script build")));
    }
}
