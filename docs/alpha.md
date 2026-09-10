# Archive `devforge-alpha`

Le dépôt [`bobdivx/devforge-alpha`](https://github.com/bobdivx/devforge-alpha) contient le monorepo legacy (PHP) tel qu’il existait avant le greenfield v2.

## Règles

- **Pas de nouvelles features** dans alpha.
- Alpha sert uniquement de **source d’extraction** pour porter des engines (SSH, Docker, GitHub) vers les crates Rust.
- Toute extraction = **réécriture** derrière traits (`RemoteExecutor`, `GitHubClient`) — pas de copier-coller PHP.
- Ce dépôt (`devforge`) est la seule surface produit active.

## Mapping

| Legacy (alpha) | Cible v2 |
|----------------|----------|
| Toolkit agent monolithe | `crates/agent` + tools unitaires |
| Jobs deploy / SSH | `crates/deploy` |
| Intégration GitHub | `crates/github` |
| Models Application | table `projects` / `deployments` |
| Surface MCP | `crates/mcp` |
| Variables d’env apps | `crates/env` |
