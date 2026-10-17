## 2026-10-12 - [Improved SVG Sanitization against mXSS]
**Vulnerability:** The manual SVG sanitizer `apps/web/src/lib/sanitize-svg.ts` used an insufficient allowlist/blocklist. It allowed `<foreignObject>`, `<use>`, `<animate>`, `<set>`, `<image>`, and `<math>` which could lead to mutation XSS (mXSS) and other attack vectors when rendering untrusted Mermaid or Math blocks.
**Learning:** Manual DOM tree sanitization is notoriously hard to get right because attackers can hide active elements (e.g. `<a>` tags with `javascript:` payloads) inside grandchild trees (like `<math><mtext><a>`) or use SVG-specific tricks (like `<animate href... values="javascript:...">`) which naive list-based cleaners overlook.
**Prevention:** Rather than adding heavy third-party dependencies (like DOMPurify) against explicit project instructions, expanding the `BLOCKED` Set to include these structural injection vectors provides a robust, zero-dependency mitigation. Future expansions should verify nested elements carefully.

## 2026-10-17 - [Missing Security Headers in Axum Backend]
**Vulnerability:** The Axum backend lacked standard security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`), which are important defense-in-depth measures against MIME-sniffing, clickjacking, and man-in-the-middle attacks.
**Learning:** In a custom Axum backend, relying solely on `tower_http`'s CORS or static cache headers is insufficient for a complete security posture. Explicitly adding security headers is required.
**Prevention:** Create and integrate a dedicated security headers middleware (or layer) using `axum` and `tower` to append these headers to all outgoing responses.
