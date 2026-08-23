# Graft Context Engine

**When to use**: Load this skill when you need deep codebase understanding, symbol tracing, or blast radius analysis. Use for complex debugging, refactoring, or architectural decisions.

## Overview

Graft provides a pre-built context graph of the DevForge codebase with 3009 indexed files. It offers instant access to:
- Symbol definitions and call hierarchies
- File API surfaces (signatures only)
- Dependency tracing (who calls what)
- Blast radius analysis (impact of changes)

## Core Benefits

**Performance**:
- 3× faster than cold searches
- 60% token reduction vs naive file reading
- No need to discover code structure each time

**Accuracy**:
- Pre-indexed relationships
- Type-aware symbol resolution
- Cross-language support (PHP, TypeScript, JavaScript, Blade)

## Available MCP Tools

When Graft MCP is active, you have access to these tools:

### `graft_find_code`
Search for symbols, classes, methods, or concepts.

**Example**:
```
graft_find_code("AiAgent deployment failed")
→ Returns ranked matches with exact file:line
```

### `graft_trace_calls`
Find who calls a symbol (callers) or what it calls (callees).

**Example**:
```
graft_trace_calls("ApplicationDeploymentJob", direction="in", depth=2)
→ Shows all callers up to 2 levels deep
```

### `graft_file_api`
Get signatures-only view of a file's API surface.

**Example**:
```
graft_file_api("backend/app/Models/AiAgent.php")
→ Returns public methods, properties, relationships without implementation
```

### `graft_repo_map`
Get high-level repository structure and key components.

**Example**:
```
graft_repo_map()
→ Returns INDEX.md with repo overview
```

### `graft_check_freshness`
Verify if the graph is up-to-date with the code.

**Example**:
```
graft_check_freshness()
→ Returns { fresh: true } or lists stale files
```

## Usage Patterns

### Pattern 1: Diagnose Deployment Failure (Relanceur)
```
1. graft_find_code("deployment failed status")
   → Finds ApplicationDeploymentJob, deployment status checks
   
2. graft_trace_calls("ApplicationDeploymentJob", direction="in")
   → Shows what triggers deployments
   
3. graft_file_api("backend/app/Jobs/ApplicationDeploymentJob.php")
   → Gets method signatures to understand workflow
```

### Pattern 2: Find Feature Implementation (Worker)
```
1. graft_find_code("user authentication 2FA")
   → Finds auth-related code
   
2. graft_trace_calls("CreateNewUser", depth=all)
   → Maps entire auth flow
   
3. graft_check_freshness()
   → Ensures working with current code
```

### Pattern 3: Impact Analysis (Veille)
```
1. graft_find_code("AiProviderConfig model")
   → Locates model definition
   
2. graft_trace_calls("AiProviderConfig", direction="in", depth=all)
   → Shows all dependencies (blast radius)
   
3. graft_file_api("backend/app/Models/AiProviderConfig.php")
   → Reviews API surface for breaking changes
```

## CLI Commands (Alternative)

If MCP tools aren't available, use CLI commands:

```bash
# Search codebase
npx graft ask "how does deployment queue work" /workspace

# Find callers
npx graft callers ApplicationDeploymentJob /workspace

# File skeleton
npx graft skeleton backend/app/Models/AiAgent.php /workspace

# Blast radius of diff
npx graft blast --diff HEAD /workspace
```

## Best Practices

### DO ✅
- Use `graft_find_code` before reading files blindly
- Check `graft_check_freshness` if graph feels stale
- Use `graft_file_api` to see API without noise
- Leverage `graft_trace_calls` for impact analysis

### DON'T ❌
- Don't bypass Graft for known concepts (wastes tokens)
- Don't assume graph is fresh after code changes (check first)
- Don't read full files when signatures suffice
- Don't trace depth=all on large symbols (start with depth=1-2)

## Graph Maintenance

The graph is stored in `/workspace/.graft/` (123MB).

**Rebuild when**:
- New files added
- Major refactoring
- Graph shows as stale

**Rebuild command**:
```bash
cd /workspace && npx graft build --dir .graft
```

Takes ~40s to rebuild entire codebase.

## Integration with DevForge Agents

### Relanceur (Deployment Operator)
- Use `graft_find_code` to locate deployment logic instantly
- Use `graft_trace_calls` to understand failure propagation
- Reduces diagnostic time from 45s to ~15s

### Veille (Technical Watch)
- Use `graft_repo_map` for architecture overview
- Use `graft_find_code` to find candidates for improvement
- Use `graft_trace_calls` to assess refactoring impact

### Worker (Feature Implementation)
- Use `graft_find_code` to locate similar implementations
- Use `graft_file_api` to understand interfaces
- Use `graft_trace_calls` to ensure no breaking changes

## Performance Impact

**Token Savings**:
- Cold approach: Read 5-10 files (~50k tokens)
- With Graft: Query + 1-2 targeted files (~15k tokens)
- **Savings: ~70%**

**Time Savings**:
- Cold approach: 30-60s to discover + read
- With Graft: 5-10s to query + read
- **Savings: ~75%**

## Troubleshooting

**"Graph not found"**:
- Run: `npx graft build --dir .graft`

**"Stale graph"**:
- Run: `npx graft check /workspace`
- If stale, rebuild with `npx graft build --dir .graft`

**"Symbol not found"**:
- Graph only indexes exported symbols
- Try broader search: `graft_find_code("<concept>")`

## References

- Graft Documentation: https://github.com/nanonets/graft
- Graph location: `/workspace/.graft/`
- MCP config: `/workspace/.mcp.json`
- Indexed files: 3009 (frontend + backend)
