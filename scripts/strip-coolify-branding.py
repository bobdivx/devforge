from pathlib import Path

ROOTS = [
    Path("backend/resources"),
    Path("backend/app"),
    Path("backend/config"),
    Path("backend/lang"),
    Path("backend/database/seeders"),
]

URL_REPLS = [
    ("https://undead.coolify.io", "https://127.0.0.1/devforge-telemetry-disabled"),
    ("https://staging-but-dev.coolify.io", "http://127.0.0.1"),
    ("https://app.coolify.io", "https://example.com"),
    ("https://coolify.io", "https://github.com/bobdivx/devforge"),
    ("https://cdn.coollabs.io/assets/coolify/og-image.png", "/brand/logo.png"),
    ("https://github.com/coollabsio/coolify", "https://github.com/bobdivx/devforge"),
    ("https://coolify.yourdomain.com", "https://devforge.yourdomain.com"),
    ("app.coolify.io", "app.example.com"),
    ("cloud.coolify.io", "cloud.example.com"),
]

TEXT_REPLS = [
    ("hosted on coolify", "hosted on DevForge"),
    ("The coolify proxy", "The proxy"),
    ("automatically update coolify", "automatically update DevForge"),
    ("coolify.io's installation count", "the anonymous installation count"),
    ("report to coolify.io", "report anonymously"),
    ("the coolify defaults", "the DevForge defaults"),
    ("All resources hosted on coolify", "All resources hosted on DevForge"),
    ("Starting coolify-proxy.", "Starting proxy."),
    ("Successfully started coolify-proxy.", "Successfully started proxy."),
    ("Stopping and removing existing coolify-proxy.", "Stopping and removing existing proxy."),
    ("Successfully stopped and removed existing coolify-proxy.", "Successfully stopped and removed existing proxy."),
    ("Waiting for coolify-proxy to be removed", "Waiting for proxy to be removed"),
    ("Error in restoring coolify db backup", "Error in restoring instance db backup"),
    ("@coolifyio", "@devforge"),
    ('data-domain="app.example.com"', 'data-domain=""'),
    ("utm_source=coolify.io", "utm_source=devforge"),
]


def main() -> None:
    changed: list[str] = []
    for root in ROOTS:
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in {".php", ".json", ".css"}:
                continue
            text = path.read_text(encoding="utf-8")
            updated = text
            for old, new in URL_REPLS:
                updated = updated.replace(old, new)
            for old, new in TEXT_REPLS:
                updated = updated.replace(old, new)
            if updated != text:
                path.write_text(updated, encoding="utf-8", newline="\n")
                changed.append(str(path))

    print(f"updated {len(changed)} files")
    for item in changed:
        print(item)


if __name__ == "__main__":
    main()
