# Stockage et sauvegardes

## Storage S3-compatible

Page `/app/storage` + Settings. Crate `storage` : buckets / objets.

API : `/api/v1/storage/buckets` · `/{bucket}/objects`.

Fallback mémoire si aucun backend n’est configuré (dev). En prod : credentials dans l’UI.

## Backups projet

Onglet projet **Backups** : jobs vers le storage configuré, restore preview.

`/api/v1/projects/{uuid}/backups`

## Backups instance

Settings → Sauvegardes (S3). **Pas de variables d’env** pour ça.

- Config + test : `/api/v1/settings/backup-s3`
- Liste locale / remote + restore : `/api/v1/instance/backups`

La DB SQLite et les données sous `DEVFORGE_DATA_DIR` sont le cœur à sauver.
