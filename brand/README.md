# Brand DevForge

Logo officiel (source générée / choisie) : ruban géométrique violet → magenta sur fond sombre.

| Fichier | Usage |
|---------|--------|
| `icon-source.jpg` | Master original (1024²) |
| `icon-1024.png` / `icon-512.png` … | Exports raster |
| `icon.svg` | SVG (PNG embarqué 512) — source brand |
| `logo.svg` | Icône + wordmark |

Copies synchronisées :

- `deploy/zimaos/icon.svg` — URL publique CasaOS / ZimaOS / Flatpak  
  `https://raw.githubusercontent.com/bobdivx/devforge/main/deploy/zimaos/icon.svg`
- `deploy/zimaos/icon.png` — export raster (optionnel)
- `apps/web/public/favicon.svg` (+ `favicon.ico`)
- `deploy/windows/devforge.ico`
- Flatpak : installe `deploy/zimaos/icon.svg`

Pour régénérer après un nouveau master :

```bash
magick brand/icon-source.jpg -strip brand/icon-1024.png
for s in 512 256 128 64 32; do magick brand/icon-1024.png -resize ${s}x${s} brand/icon-${s}.png; done
# puis réécrire les SVG embarqués + ICO (voir historique / agent)
```

Note : le SVG embarque le PNG (pas encore de tracé vectoriel pur). On pourra vectoriser plus tard si besoin.
