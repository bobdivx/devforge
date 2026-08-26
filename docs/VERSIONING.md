# DevForge Versioning System

DevForge uses automated version bumping to ensure every Docker image build on `main` has a unique semver tag that the updates page can detect.

## How It Works

### Automated Version Bumping (CI)

Every push to `main` that triggers the **DevForge Docker Images** workflow will:

1. **Auto-bump** the patch version in:
   - `backend/config/constants.php` (`coolify.version`)
   - `backend/versions.json` (`devforge.version` and `coolify.v4.version`)

2. **Commit** the bumped version with message:
   ```
   chore: bump version to X.Y.Z [skip version bump]
   ```
   The `[skip version bump]` marker prevents an infinite trigger loop.

3. **Build** all Docker images (`api`, `web`, `realtime`, `helper`, `proxy`) with tags:
   - `bobdivx/devforge:latest` (for `api` component)
   - `bobdivx/devforge:X.Y.Z` (for `api` component)
   - `bobdivx/devforge:{component}-X.Y.Z` (for all components)
   - Plus `:sha-XXXXXXX` tags for rollback

4. **Push** images to Docker Hub and GHCR.

### Version Detection

The live DevForge instance:
- Reads its **running version** from `backend/config/constants.php` (baked into the image)
- Fetches the **latest available version** from GitHub:
  ```
  https://raw.githubusercontent.com/bobdivx/devforge/main/backend/versions.json
  ```
- Compares semver strings
- Shows an update notification at `/settings/updates/` when a newer version is available

### Loop Prevention

The workflow checks the commit message:
```yaml
if: "!contains(github.event.head_commit.message, '[skip version bump]')"
```

Commits with `[skip version bump]` skip the `bump-version` job, preventing re-triggers from the version bump commit itself.

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

## Workflow Dispatch

You can also trigger a build manually via GitHub Actions:
1. Go to **Actions** → **DevForge Docker Images**
2. Click **Run workflow** → **Run workflow** on `main`
3. The version will be auto-bumped (unless the last commit already contains `[skip version bump]`)

## Files Involved

### Version Source Files
- **`backend/config/constants.php`** — The running app's version (read by `getVersion.php`)
- **`backend/versions.json`** — Published to GitHub; fetched by the updates page

### Version Reading
- **`backend/bootstrap/getVersion.php`** — Reads `constants.php` and echoes the version
- Used by Docker Images workflow to tag images

### Automation
- **`.github/workflows/devforge-images.yml`** — CI workflow with `bump-version` job
- **`scripts/bump-devforge-version.sh`** — Manual bump helper script

## Troubleshooting

### Updates Page Shows No New Version

**Symptom**: Running `4.1.4`, but `/settings/updates/` shows "up to date" even though newer images exist on Docker Hub.

**Cause**: `backend/versions.json` on GitHub still shows `4.1.4`.

**Fix**: Ensure the `bump-version` job ran and committed the new version. Check:
```bash
git log --oneline -n 5 origin/main
```
You should see `chore: bump version to X.Y.Z [skip version bump]` commits.

### Infinite Workflow Loops

**Symptom**: The workflow keeps triggering itself.

**Cause**: The `[skip version bump]` marker is missing or the `if` condition is broken.

**Fix**: Check the bump-version job's commit message includes `[skip version bump]`.

### Version Not Bumped

**Symptom**: The workflow ran but the version stayed the same.

**Cause**: The `bump-version` job was skipped because the last commit already contained `[skip version bump]`.

**Fix**: This is expected behavior. If you need to force a version bump, make any change to trigger the workflow again (without `[skip version bump]` in your commit message).

## Migration Note

Before this system, version `4.1.3` was hardcoded and never changed. Each Docker build overwrote the same `bobdivx/devforge:4.1.3` tag, so the updates page always compared `4.1.3` vs `4.1.3` = no update detected.

Now, every build on `main` creates a new semver tag (4.1.4, 4.1.5, 4.1.6, ...), and `versions.json` on GitHub reflects the latest version, allowing the updates detection loop to work as designed.
