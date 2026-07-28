## ADDED Requirements

### Requirement: Detect runtime hints from deployed app source
The system SHALL derive Coolify build/runtime parameter suggestions for a deployed application by reading that application's GitHub source under its `base_directory`, starting with `package.json` and, when present, framework config files (`astro.config.*`, `vite.config.*`, `next.config.*`, `nuxt.config.*`, `nixpacks.toml`).

#### Scenario: Node app with package.json scripts
- **WHEN** the application source contains a readable `package.json` with a `build` script and a lockfile indicating npm
- **THEN** the system MUST return hints including `install_command` and `build_command` with confidence at least `medium`, and MUST include the list of source files read

#### Scenario: Astro static output directory
- **WHEN** the source indicates Astro with static output (config or equivalent) and an `outDir` of `dist` (explicit or default)
- **THEN** the system MUST suggest `publish_directory` as `/dist` and `is_static` as true when static serving applies

#### Scenario: Astro SSR
- **WHEN** the source indicates Astro server/SSR output
- **THEN** the system MUST suggest `is_static` as false and MUST suggest a `start_command` and `ports_exposes` appropriate for Astro SSR defaults unless overridden by scripts/config

#### Scenario: Missing package.json
- **WHEN** no `package.json` exists under the application `base_directory`
- **THEN** the system MUST report detection as unavailable with a clear reason and MUST NOT invent Node install/build commands

### Requirement: Runtime hints API for existing applications
The system SHALL expose an authenticated DevForge API endpoint that returns runtime hints for an existing application UUID scoped to the current team.

#### Scenario: Authorized team member requests hints
- **WHEN** a team member with access to the application requests runtime hints for that application UUID
- **THEN** the system MUST return the hints payload (or unavailable reason) without mutating application settings

#### Scenario: Cross-team access denied
- **WHEN** a user requests runtime hints for an application outside their team
- **THEN** the system MUST deny the request

### Requirement: Runtime hints preview before application creation
The system SHALL expose an authenticated DevForge API that accepts GitHub app, repository, branch, and optional base directory, and returns the same hint shape used for existing applications, without requiring a persisted Application row.

#### Scenario: Preview after repo selection
- **WHEN** the client supplies a valid GitHub app UUID, repository, and branch that contain a `package.json`
- **THEN** the system MUST return detection hints usable to prefill create-application fields

### Requirement: Prefill create application flow
The DevForge create-application UI SHALL request runtime hints after repository and branch are selected and SHALL prefill the create draft with available hint values before the first deployment is queued.

#### Scenario: Instant deploy with detected publish directory
- **WHEN** the user creates an application with instant deploy enabled and hints include a `publish_directory`
- **THEN** the system MUST apply those runtime settings before or as part of the first deploy so the first build does not run with stale default publish settings that contradict the hints

### Requirement: Detect button on runtime settings panel
The DevForge application runtime settings panel SHALL provide an action to detect settings from the repository that populates the unsaved draft from hints without persisting until the user saves.

#### Scenario: User detects then saves
- **WHEN** the user clicks detect-from-repo on an existing application and then saves
- **THEN** the draft MUST be filled from returned hints and only the save action MAY persist settings and optionally queue redeploy

#### Scenario: User detects then discards
- **WHEN** the user clicks detect-from-repo and navigates away without saving
- **THEN** persisted application runtime settings MUST remain unchanged

### Requirement: Shared detection for agents
The agent tooling surface SHALL be able to obtain the same runtime hints as the UI for a given application (dedicated tool or enrichment of an existing runtime-settings read), so repair flows do not reimplement divergent heuristics.

#### Scenario: Agent reads hints before update
- **WHEN** an agent needs to correct Coolify runtime settings for a failing deploy
- **THEN** it MUST be able to retrieve structured hints from the shared detection service before calling update runtime settings
