//! Framework detection helpers for API routes.

use devforge_detect::{detect, scan_local_dir, tree_from_names, DetectionResult, FileTree};
use devforge_github::GitHubFacade;
use std::collections::HashMap;
use std::path::Path;

const INTERESTING: &[&str] = &[
    "package.json",
    "composer.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
    "Pipfile",
    "Gemfile",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "artisan",
    "index.html",
    "astro.config.mjs",
    "astro.config.ts",
    "next.config.js",
    "next.config.mjs",
    "vite.config.ts",
    "vite.config.js",
    ".env.example",
    ".env.sample",
    ".env.template",
    "Procfile",
    "nixpacks.toml",
];

pub async fn detect_github_repo(
    github: &GitHubFacade,
    owner: &str,
    repo: &str,
    branch: Option<&str>,
) -> Result<DetectionResult, String> {
    let entries = github
        .list_dir(owner, repo, "", branch)
        .await
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = entries.iter().map(|(n, _)| n.clone()).collect();
    let mut contents = HashMap::new();
    for (name, is_file) in &entries {
        if !*is_file {
            continue;
        }
        let lower = name.to_lowercase();
        if INTERESTING.iter().any(|i| i.eq_ignore_ascii_case(name))
            || lower.ends_with(".json")
            || lower == "dockerfile"
        {
            if let Ok(Some(text)) = github.read_file(owner, repo, name, branch).await {
                contents.insert(name.clone(), text);
            }
        }
    }
    let tree = tree_from_names(&names, contents);
    Ok(detect(&tree))
}

pub fn detect_workdir(workdir: &str) -> DetectionResult {
    let path = Path::new(workdir);
    if !path.is_dir() {
        return DetectionResult::unknown();
    }
    let tree = scan_local_dir(path);
    detect(&tree)
}

#[allow(dead_code)]
pub fn detect_from_tree(tree: &FileTree) -> DetectionResult {
    detect(tree)
}
