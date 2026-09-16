# Runners

Page `/app/runners` : runners **GitHub Actions self-hosted** gérés par DevForge (crate `runner`).

- Liste, création, sync
- Start / stop / remove
- Logs et jobs
- Stream d’événements `GET /api/v1/runners/events`

Ce n’est **pas** la même chose que les **workers cluster** (compute DevForge). Runners = CI GitHub. Cluster = où tes apps PaaS tournent. Tu peux avoir les deux sur la même machine.

API : `/api/v1/runners`, `.../{id}/logs`, `.../jobs`, `.../{id}/{action}`, `POST /api/v1/runners/sync`.
