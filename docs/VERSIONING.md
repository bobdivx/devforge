# DevForge Versioning System

DevForge uses automated version bumping to ensure every Docker image build on `main` has a unique semver tag that the updates page can detect.

## How It Works

### Automated Version Bumping (CI)

Every push to `main` that triggers the **DevForge Docker Images** workflow will:

1. **`prepare` job**: Calculate the next version
   - Read current version from `backend/config/constants.php` (`coolify.version`)
   - Increment patch: `4.1.3` → `4.1.4`
   - Output `current` and `version` for downstream jobs
   - **Does NOT commit yet** — version is only calculated

2. **`build` job**: Apply version patch and build images
   - Checkout the triggering commit (not `main` — avoids race conditions)
   - Apply the version patch to workspace files:
     - `backend/config/constants.php` (`coolify.version`)
     - `backend/versions.json` (`devforge.version` and `coolify.v4.version`)
   - Build all Docker images (`api`, `web`, `realtime`, `helper`, `proxy`)
   - Push to Docker Hub with tags:
     - `bobdivx/devforge:latest` (for `api`)
     - `bobdivx/devforge:X.Y.Z` (for `api`)
     - `bobdivx/devforge:{component}-X.Y.Z` (for all components)
     - Plus `:sha-XXXXXXX` tags for rollback
   - Also mirror to GHCR

3. **`commit-version` job**: Update GitHub main (only if build succeeded)
   - Runs **only after** the full build matrix succeeds
   - Checkout `main` branch
   - Apply the same version patch
   - Commit with message: `chore: bump version to X.Y.Z [skip version bump]`
   - Push to GitHub: `git push origin HEAD:main`
   - This updates `backend/versions.json` on GitHub for the updates page

### Why This Order?

**Old broken flow**: bump+commit → build  
❌ If build fails, GitHub has `4.1.4` but Hub still has `4.1.3` → updates page lies

**Correct flow**: prepare → build+push → commit (only if success)  
✅ Docker Hub and GitHub versions always match  
✅ If build fails, GitHub stays at `4.1.3` and no bad version is published

### Version Detection

The live DevForge instance:
- Reads its **running version** from `backend/config/constants.php` (baked into the image)
- Fetches the **latest available version** from two sources:
  1. **Primary**: Public `versions.json` from devforge-store repo:
     ```
     https://raw.githubusercontent.com/bobdivx/devforge-store/main/versions.json
     ```
  2. **Fallback**: Docker Hub API (if primary fails, e.g., private repo 404)
     - Queries `https://hub.docker.com/v2/repositories/bobdivx/devforge/tags`
     - Filters plain semver tags (e.g., `4.1.4`, ignores `api-4.1.4`, `sha-*`, `latest`)
     - Uses the highest version available
- Compares semver strings
- Shows an update notification at `/settings/updates/` when a newer version is available

**Note**: The main `bobdivx/devforge` repo is private, so raw GitHub URLs return 404 for unauthenticated requests. The public `devforge-store` repo hosts `versions.json` for update checks. If that file is stale or unavailable, Docker Hub serves as the source of truth.

### Loop Prevention

**Q**: Why doesn't the version bump commit re-trigger the workflow infinitely?

**A**: Two safeguards:
1. `GITHUB_TOKEN` pushes **do not trigger workflows** (GitHub native behavior)
2. Even if a PAT were used later, the `[skip version bump]` marker in commit messages can be checked (currently not enforced because safeguard #1 is sufficient)

The `commit-version` job also checks if files already have the target version and skips the commit if so (idempotent).

## Manual Version Bumping

For local development or manual version control, use the helper script:

```bash
# Bump patch version (4.1.3 → 4.1.4)
./scripts/bump-devforge-version.sh

# Bump minor version (4.1.3 → 4.2.0)
./scripts/bump-devforge-version.sh minor

# Bump major version (4.1.3 → 5.0.0)
./scripts/bump-devforge-version.sh major
```

Then commit and push:
```bash
git add backend/config/constants.php backend/versions.json
git commit -m "chore: bump version to X.Y.Z"
git push
```

**Note**: Manual bumps will trigger the CI workflow, which will compute the **next** version from your manual bump. If you manually set `4.2.0`, the workflow will build `4.2.0` then commit `4.2.1` preparation for the next build.

## Workflow Dispatch

You can also trigger a build manually via GitHub Actions:
1. Go to **Actions** → **DevForge Docker Images**
2. Click **Run workflow** → **Run workflow** on `main`
3. The version will be auto-bumped (always — no skip logic)

## Files Involved

### Version Source Files
- **`backend/config/constants.php`** — The running app's version (read by `getVersion.php`)
- **`backend/versions.json`** — Published to GitHub; fetched by the updates page

### Version Reading
- **`backend/bootstrap/getVersion.php`** — Reads `constants.php` and echoes the version
- Used by Docker Images workflow to tag images

### Automation
- **`.github/workflows/devforge-images.yml`** — CI workflow with `prepare` → `build` → `commit-version` jobs
- **`scripts/bump-devforge-version.sh`** — Manual bump helper script

## Troubleshooting

### Updates Page Shows No New Version

**Symptom**: Running `4.1.4`, but `/settings/updates/` shows "up to date" even though newer images exist on Docker Hub.

**Cause**: `backend/versions.json` on GitHub still shows `4.1.4`.

**Fix**: Check that the `commit-version` job ran and committed the new version:
```bash
git log --oneline -n 5 origin/main
```
You should see `chore: bump version to X.Y.Z [skip version bump]` commits after successful builds.

### Build Failed But GitHub Has New Version

**Symptom**: Workflow failed during build matrix, but `versions.json` was updated.

**Cause**: Old broken workflow (pre-fix) that committed before building.

**Fix**: This is now impossible with the correct flow (`prepare` → `build` → `commit-version`). The `commit-version` job only runs if the full build matrix succeeds (`if: success()`).

### Version Not Bumped

**Symptom**: The workflow ran but the version stayed the same.

**Cause**: The `commit-version` job detected files already have the target version (idempotent check).

**Fix**: This is expected behavior when re-running a workflow. Each new code push will trigger a fresh bump.

## Jobs Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Push to main (code change)                              │
└────────────────────┬────────────────────────────────────┘
                     ↓
         ┌───────────────────────┐
         │  prepare job          │
         │  - Checkout trigger   │
         │  - Read 4.1.3         │
         │  - Compute 4.1.4      │
         │  - Output versions    │
         └───────────┬───────────┘
                     ↓
         ┌───────────────────────┐
         │  build job (matrix)   │
         │  - Checkout trigger   │
         │  - Patch to 4.1.4     │
         │  - Build images       │
         │  - Push to Hub/GHCR   │
         │    :4.1.4, :latest    │
         └───────────┬───────────┘
                     ↓
              ┌──────────┐
              │ Success? │
              └─────┬────┘
                    │ ✓ All jobs passed
                    ↓
         ┌───────────────────────┐
         │  commit-version job   │
         │  - Checkout main      │
         │  - Patch to 4.1.4     │
         │  - Commit + push      │
         │    [skip version bump]│
         └───────────┬───────────┘
                     ↓
         ┌───────────────────────┐
         │ GitHub main updated   │
         │ versions.json = 4.1.4 │
         └───────────────────────┘
                     ↓
   ┌─────────────────────────────────────────┐
   │ Live instance fetches versions.json     │
   │ Running: 4.1.3 < Available: 4.1.4       │
   │ /settings/updates/ shows "Update ready" │
   └─────────────────────────────────────────┘
```

## Migration Note

Before this system, version `4.1.3` was hardcoded and never changed. Each Docker build overwrote the same `bobdivx/devforge:4.1.3` tag, so the updates page always compared `4.1.3` vs `4.1.3` = no update detected.

Now, every build on `main` creates a new semver tag (4.1.4, 4.1.5, 4.1.6, ...) **after successfully pushing to Docker Hub**, and `versions.json` on GitHub is updated only when images are confirmed published, ensuring the updates detection loop works reliably.
