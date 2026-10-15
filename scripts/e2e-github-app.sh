#!/usr/bin/env bash
# E2E GitHub App on a sandbox repo: push ⇒ green check; PR ⇒ preview + comment; close ⇒ cleanup.
# Requires: gh (authenticated), DEVFORGE_URL, DEVFORGE_API_TOKEN (never printed), SANDBOX_REPO (owner/name),
# SANDBOX_PROJECT (DevForge uuid of the project linked to the app).
set -euo pipefail
: "${DEVFORGE_URL:?}" "${DEVFORGE_API_TOKEN:?}" "${SANDBOX_REPO:?}" "${SANDBOX_PROJECT:?}"
api() { curl -fsS -H "Authorization: Bearer ${DEVFORGE_API_TOKEN}" "$DEVFORGE_URL/api/v1$1"; }
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
gh repo clone "$SANDBOX_REPO" "$work/r" -- -q
cd "$work/r"
br="e2e-$(date +%s)"
git checkout -q -b "$br"
date -u > .e2e && git add .e2e && git commit -qm "e2e: preview" && git push -q origin "$br"
sha=$(git rev-parse HEAD)
pr=$(gh pr create -R "$SANDBOX_REPO" -H "$br" -t "e2e preview" -b "e2e" | grep -o '[0-9]*$')
echo "PR #$pr ($sha)"
for _ in $(seq 1 60); do
  st=$(api "/projects/$SANDBOX_PROJECT/previews" | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((p['status']+' '+(p.get('url') or '') for p in d['previews'] if p['pr_number']==$pr),''))")
  case "$st" in ready*) break;; failed*) echo "preview failed"; exit 1;; esac
  sleep 10
done
url=${st#ready }; echo "preview: $url"
curl -fsS -o /dev/null -w "smoke %{http_code}\n" "$url"
n=$(gh api "repos/$SANDBOX_REPO/issues/$pr/comments" --jq "[.[]|select(.body|contains(\"devforge-preview:$SANDBOX_PROJECT\"))]|length")
[ "$n" = 1 ] || { echo "expected 1 comment, got $n"; exit 1; }
gh api "repos/$SANDBOX_REPO/commits/$sha/check-runs" --jq '.check_runs[]|.name+" "+(.conclusion//"")'
gh pr close -R "$SANDBOX_REPO" "$pr" -d
for _ in $(seq 1 12); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)
  [ "$code" = 404 ] || [ "$code" = 000 ] && { echo "cleanup OK ($code)"; exit 0; }
  sleep 10
done
echo "preview still reachable after closing"; exit 1
