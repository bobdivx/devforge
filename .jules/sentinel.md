## 2026-10-12 - [Improved SVG Sanitization against mXSS]
**Vulnerability:** The manual SVG sanitizer `apps/web/src/lib/sanitize-svg.ts` used an insufficient allowlist/blocklist. It allowed `<foreignObject>`, `<use>`, `<animate>`, `<set>`, `<image>`, and `<math>` which could lead to mutation XSS (mXSS) and other attack vectors when rendering untrusted Mermaid or Math blocks.
**Learning:** Manual DOM tree sanitization is notoriously hard to get right because attackers can hide active elements (e.g. `<a>` tags with `javascript:` payloads) inside grandchild trees (like `<math><mtext><a>`) or use SVG-specific tricks (like `<animate href... values="javascript:...">`) which naive list-based cleaners overlook.
**Prevention:** Rather than adding heavy third-party dependencies (like DOMPurify) against explicit project instructions, expanding the `BLOCKED` Set to include these structural injection vectors provides a robust, zero-dependency mitigation. Future expansions should verify nested elements carefully.
## 2026-10-22 - [Bypass Command Parsing and Path Traversal fix]
**Vulnerability:** The `validate_read_only` function in `crates/agent/src/tools/workdir_cmd.rs` allowed command parsing bypass (using quoted paths like `cat ".."/".."/etc/passwd`) which facilitated path traversal because the check only matched against the literal block string `../`.
**Learning:** Checking for exact substrings against raw commands is highly fragile against obfuscation, such as Unix-style quotation.
**Prevention:** Validation for string containment (such as blocking `..`) should run against the tokenized and normalized (i.e., lower-case without surrounding quotes) arguments, not the unparsed raw command line.

## 2023-10-25 - [Fix Masking of Secrets in Environment Variables]
**Vulnerability:** The `mask_sensitive_env_key` function in `docker.rs` was not properly masking environment variables that contained sensitive keywords (like `AWS_SECRET_ACCESS_KEY`) because it only checked for exact matches or suffix matches (e.g., ends with `_SECRET`).
**Learning:** Only matching for suffixes or exact values can leave secrets exposed when developers prefix or infix the sensitive word in the environment variable name.
**Prevention:** Use substring matching (`contains`) for sensitive keywords to ensure all variables containing words like `SECRET` or `TOKEN` are masked.


## 2026-10-18 - [Timing Attack in Webhook Signature Verification]
**Vulnerability:** The `verify_github_sig` function in `apps/server/src/infra_routes.rs` verified GitHub webhook signatures using standard string comparison `expected.eq_ignore_ascii_case(hex_sig)`.
**Learning:** String comparison functions exit early as soon as a character mismatch is found. In a cryptographic context, this variable response time leaks information and allows an attacker to perform a timing attack to forge a valid HMAC signature by guessing it byte by byte.
**Prevention:** Always use a constant-time comparison library (like `hmac`'s `verify_slice()`) to compare cryptographic hashes, secrets, and signatures to prevent side-channel timing attacks. Avoid custom implementations of standard cryptographic algorithms.
