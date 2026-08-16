from pathlib import Path
import re

ROOTS = [
    Path("backend/app"),
    Path("backend/resources"),
    Path("backend/config"),
    Path("backend/bootstrap"),
    Path("backend/database/seeders"),
    Path("frontend/src"),
]

DOC_LINK = re.compile(r"https://github\.com/bobdivx/devforge/docs[^\s\"'<>]*")
HETZNER = "https://github.com/bobdivx/devforge/hetzner"
DISCORD = "https://github.com/bobdivx/devforge/discord"
REPO = "https://github.com/bobdivx/devforge"


def main() -> None:
    changed: list[str] = []
    for root in ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in {".php", ".json", ".css", ".tsx", ".ts", ".astro"}:
                continue
            text = path.read_text(encoding="utf-8")
            updated = DOC_LINK.sub(REPO, text)
            updated = updated.replace(HETZNER, "https://www.hetzner.com")
            updated = updated.replace(DISCORD, REPO)
            updated = updated.replace("https://coolify.io", REPO)
            if updated != text:
                path.write_text(updated, encoding="utf-8", newline="\n")
                changed.append(str(path))

    print(f"updated {len(changed)} files")
    for item in changed:
        print(item)


if __name__ == "__main__":
    main()
