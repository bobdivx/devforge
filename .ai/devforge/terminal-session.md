# Unit test for TerminalSessionCommand (no DB — pure service contract via mocks)

This file documents the expected contract when Feature tests cannot run locally
without Docker. Prefer `tests/Unit/DevForge/TerminalSessionCommandTest.php`
and `tests/Feature/DevForgeRealtimeApiTest.php` inside Docker:

```bash
docker exec coolify php artisan test --compact tests/Unit/DevForge/TerminalSessionCommandTest.php
docker exec coolify php artisan test --compact --filter=creates.a.terminal.session
```
