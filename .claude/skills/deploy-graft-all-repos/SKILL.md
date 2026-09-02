# Skill: Deploy Graft to All Repos

**When to use**: Automatically deploy Graft context graph to all team repositories via GitHub API.

## Mission

Deploy Graft (NanoNets context graph) to all team repositories:
- Install `@nanonets/graft` in package.json
- Create `.mcp.json` with Graft server config
- Add `.graft/` to `.gitignore`
- Create `GRAFT.md` documentation
- Commit changes to main branch (or PR if protected)

## Workflow

### 1. List Target Repositories

```
Use list_github_apps to find connected GitHub Apps
Use list_github_repos for each app to get full repo list
Filter to repos owned by the team (match against application repos)
```

Target repos (from DevForge apps):
- bobdivx/TeslaReports
- bobdivx/aline-farm
- bobdivx/eventlist
- bobdivx/macompta
- bobdivx/mf3d-filaments
- bobdivx/popcorn-client
- bobdivx/popcorn-web
- bobdivx/sonozz
- bobdivx/starbasefr
- bobdivx/tesla

### 2. For Each Repository

#### Step 2.1: Check Current State

```
read_github_file("package.json", ref="main")
→ Check if @nanonets/graft already present

read_github_file(".mcp.json", ref="main")
→ Check if Graft MCP server configured

read_github_file(".gitignore", ref="main")
→ Check if .graft/ excluded

read_github_file("GRAFT.md", ref="main")
→ Check if documentation exists
```

**If all 4 exist → Skip this repo** (already done)

#### Step 2.2: Prepare Changes

**package.json**:
- Read current content
- Parse JSON
- Add to `devDependencies`: `"@nanonets/graft": "^latest"`
- Stringify with 2-space indent
- **Write back** with `write_github_file`

**mcp.json**:
- If exists, parse and merge
- If not, create new:
```json
{
  "mcpServers": {
    "graft": {
      "command": "npx",
      "args": ["graft", "mcp", "--dir", ".graft"],
      "env": {}
    }
  }
}
```
- **Write** with `write_github_file`

**.gitignore**:
- Read current content
- Check if contains `.graft`
- If not, append:
```
# Graft context graph (regenerable)
/.graft/
```
- **Write** back with `write_github_file`

**GRAFT.md**:
- Create new file with content:
```markdown
# Graft Context Graph

Navigation ultra-rapide du codebase avec Graft (NanoNets).

## Outils MCP Disponibles

- `graft_find_code(query)` — Recherche symboles
- `graft_trace_calls(symbol, direction, depth)` — Trace appels
- `graft_file_api(file)` — Signatures API
- `graft_repo_map()` — Vue d'ensemble
- `graft_check_freshness()` — Vérifier fraîcheur

## Performance

- **-70% tokens** (50k → 15k par recherche)
- **3× plus rapide** que recherche manuelle
- **file:line exact**

## CLI

```bash
npx graft ask "query" --dir .graft
npx graft callers Symbol --dir .graft
npx graft skeleton file.ts --dir .graft
```

## Générer le Graphe

Après avoir installé les dépendances (`npm install`):

```bash
npx graft build --dir .graft
```

Temps : 10-60s selon taille du codebase.

## Régénérer

Après gros changements :
```bash
npx graft build --dir .graft
```

---

Voir [devforge/docs/GRAFT_INTEGRATION.md](https://github.com/bobdivx/devforge/blob/main/docs/GRAFT_INTEGRATION.md) pour documentation complète.

Auto-déployé par DevForge Agent Automation
```
- **Write** with `write_github_file`

**README.md Update** (optional):
- Read current README
- Check if Graft mentioned
- If not, add badge or section:
```markdown
## 🧠 AI-Powered Navigation

This repo uses [Graft](https://github.com/nanonets/graft) for ultra-fast codebase navigation in Cursor.
```

#### Step 2.3: Commit Strategy

**Option A: Direct Commit to Main** (if branch not protected)
- Use `write_github_file` with `branch=main`
- Commit message: `feat: add Graft context graph for AI navigation`

**Option B: Create PR** (if main protected)
- Create branch: `create_github_branch("feat/add-graft-{timestamp}", sha=main_sha)`
- Write files to new branch
- Create PR: `create_github_pull_request`
  - Title: `feat: add Graft context graph for AI navigation`
  - Body:
```markdown
## 🧠 Adds Graft Context Graph

Deploys [Graft (NanoNets)](https://github.com/nanonets/graft) for ultra-fast AI-powered codebase navigation.

### Changes
- ✅ Add `@nanonets/graft` to devDependencies
- ✅ Configure Graft MCP server (`.mcp.json`)
- ✅ Exclude `.graft/` from git (`.gitignore`)
- ✅ Add documentation (`GRAFT.md`)

### Benefits
- **-70% tokens** for AI searches (50k → 15k)
- **3× faster** than manual grep
- **Exact file:line** navigation
- **Call tracing** (who calls what)

### Next Steps
After merge:
1. `npm install` to install Graft
2. `npx graft build --dir .graft` to generate graph (30-60s)
3. Graph regenerates automatically when needed

### Performance Impact
- **~$15-20/month** savings per active agent
- **3-5 minutes** faster diagnostic cycles
- **Better code understanding** for AI assistants

---

Auto-deployed by DevForge Agent Automation  
See [GRAFT_INTEGRATION.md](https://github.com/bobdivx/devforge/blob/main/docs/GRAFT_INTEGRATION.md) for details
```

### 3. Progress Tracking

For each repo, log:
```
✅ repo-name — committed to main
🔀 repo-name — PR #123 created
⏭️ repo-name — already has Graft
❌ repo-name — error: {reason}
```

### 4. Summary Report

At the end:
```
Graft Deployment Summary
========================

✅ Successfully deployed: 7 repos
🔀 PRs created: 2 repos
⏭️ Already configured: 1 repo
❌ Failed: 0 repos

Total repos processed: 10/10

Next steps:
- Review PRs and merge
- In each repo, run: npm install && npx graft build --dir .graft
- Verify: npx graft ask "main class" --dir .graft

Estimated savings: ~$150-200/month for team
```

## Important Notes

### package.json Handling

**DO**:
- Parse JSON properly
- Preserve existing formatting when possible
- Add to `devDependencies` (not `dependencies`)
- Use `^latest` or specific version

**DON'T**:
- Overwrite entire package.json
- Remove existing dependencies
- Change formatting drastically
- Add to wrong section

### Commit Messages

Follow conventional commits:
```
feat: add Graft context graph for AI navigation

- Install @nanonets/graft for codebase indexing
- Configure Graft MCP server (.mcp.json)
- Exclude .graft/ from git (.gitignore)
- Add GRAFT.md documentation

Performance: -70% tokens, 3× faster searches
Auto-deployed by DevForge Agent Automation
```

### Error Handling

**Common errors**:
- `package.json not found` → Skip repo (not a Node.js project)
- `main branch protected` → Create PR instead
- `file too large` → Skip or use alternative approach
- `rate limit` → Wait and retry with exponential backoff

**Retry strategy**:
- Max 3 retries per file operation
- Exponential backoff: 2s, 4s, 8s
- Log all errors for manual review

### Verification

After deployment, verify one repo manually:
```bash
# Clone repo
git clone git@github.com:bobdivx/<repo>.git
cd <repo>

# Install deps
npm install

# Generate graph
npx graft build --dir .graft

# Test
npx graft ask "main component" --dir .graft
npx graft callers "MainClass" --dir .graft

# Check MCP config
cat .mcp.json

# Verify gitignore
grep .graft .gitignore
```

## Anti-Patterns

❌ **DON'T**:
- Commit directly to protected main branches
- Overwrite existing `.mcp.json` without merging
- Generate the `.graft/` folder and commit it (it's huge!)
- Delete existing configuration
- Make changes without checking current state first

✅ **DO**:
- Check if Graft already configured before making changes
- Merge with existing `.mcp.json` if present
- Create PR for protected branches
- Log all operations for auditability
- Handle errors gracefully

## Success Criteria

Deployment is successful when:
1. ✅ All 10 target repos have Graft configured
2. ✅ Either committed to main OR PR created
3. ✅ No manual intervention needed
4. ✅ Changes are idempotent (can run multiple times safely)
5. ✅ Summary report generated

## Example Tool Sequence

```javascript
// 1. List repos
const apps = await list_github_apps();
const repos = await list_github_repos({ app_id: apps[0].id });

// 2. For each repo
for (const repo of targetRepos) {
  // Check state
  const hasPackageJson = await read_github_file({ 
    path: "package.json", 
    repo: repo.full_name,
    ref: "main"
  });
  
  if (!hasPackageJson) continue; // Not a Node.js project
  
  const hasMcpJson = await read_github_file({
    path: ".mcp.json",
    repo: repo.full_name,
    ref: "main"
  });
  
  // Parse and update package.json
  const pkg = JSON.parse(hasPackageJson.content);
  if (!pkg.devDependencies) pkg.devDependencies = {};
  if (pkg.devDependencies["@nanonets/graft"]) {
    log("⏭️", `${repo.name} already has Graft`);
    continue;
  }
  
  pkg.devDependencies["@nanonets/graft"] = "^latest";
  
  // Write package.json
  await write_github_file({
    repo: repo.full_name,
    path: "package.json",
    content: JSON.stringify(pkg, null, 2),
    message: "feat: add Graft context graph",
    branch: "main"
  });
  
  // Write .mcp.json
  const mcpConfig = hasMcpJson 
    ? JSON.parse(hasMcpJson.content)
    : { mcpServers: {} };
    
  mcpConfig.mcpServers.graft = {
    command: "npx",
    args: ["graft", "mcp", "--dir", ".graft"],
    env: {}
  };
  
  await write_github_file({
    repo: repo.full_name,
    path: ".mcp.json",
    content: JSON.stringify(mcpConfig, null, 2),
    message: "feat: configure Graft MCP server",
    branch: "main"
  });
  
  // ... similar for .gitignore and GRAFT.md
  
  log("✅", `${repo.name} — Graft deployed`);
}
```

## Performance

Expected runtime:
- **Per repo**: 10-20 seconds (API calls + file operations)
- **10 repos**: 2-3 minutes total
- **With retries**: up to 5 minutes

## Monitoring

Track metrics:
- Number of repos processed
- Success/failure rate
- PR vs direct commit ratio
- Total time taken
- Estimated token savings

---

**Use this skill to automate Graft deployment across all team repositories without manual intervention.**
