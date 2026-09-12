# Fix navigation mobile DevForge

**Branch:** `cursor/mobile-nav-ux-fix-b9a8`  
**PR:** https://github.com/bobdivx/devforge/pull/73

## Avant / Après

### AVANT
```
Dock mobile: [Apps] [Runners]
❌ MCP, Tokens, Compte, Paramètres, Admin difficiles à atteindre
❌ Avatar menu incomplet
❌ Settings chips = confusion "ancien menu global"
```

### APRÈS
```
Dock mobile: [Apps] [Plus] [Runners]
                      ↓
               ┌─────────────────┐
               │ Menu            │
               ├─────────────────┤
               │ Outils          │
               │  • MCP          │
               │  • Tokens       │
               │                 │
               │ Compte          │
               │  • Compte/équipe│
               │                 │
               │ Instance        │
               │  • Paramètres   │
               │  • Mise à jour  │
               │  • Admin (si OK)│
               └─────────────────┘

Settings page (/app/settings):
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ ⚙️ Général│ │ 🌍 Domaine│ │ GitHub │ │ 💾 Serveur│
└─────────┘ └─────────┘ └─────────┘ └─────────┘
... (grille de 8 cartes, comme Apps)

Click card → section avec bouton [← Paramètres]

✅ Tout accessible en ≤2 taps
✅ Avatar menu enrichi (+ MCP, Tokens)
✅ Settings = grille moderne (plus de chips)
```

## Architecture

### Nouveau composant
- **`MobileMenuSheet.tsx`** : bottom sheet mobile-first
  - Safe-area iOS/Android
  - Max-height 75vh, scroll interne
  - Cibles tactiles 44px minimum
  - Sections groupées logiquement
  - Highlight route active

### Modifications
1. **`nav.ts`** : `mobileBottomNav()` retourne Apps/Plus/Runners
2. **`AppShell.tsx`** : intègre `MobileMenuSheet`, `title` accepte JSX
3. **`AppHeader.tsx`** : ajoute MCP + Tokens dans avatar dropdown
4. **`SettingsPage.tsx`** : **grille de cartes** au lieu de chips
   - `SETTINGS_CARDS` avec metadata (title, description, icon)
   - `SettingsIcon()` + `SettingCard()` components
   - Bouton retour dans chaque section

## Test

Mobile ou responsive < 1024px :
1. Dock affiche 3 items (Apps · Plus · Runners)
2. Tap Plus → sheet s'ouvre
3. Vérifier accès MCP, Tokens, Compte, Paramètres, Admin
4. Avatar menu contient aussi MCP + Tokens
5. Sur `/app/settings/` → **grille de 8 cartes** (Général, Domaine, GitHub, Serveur, LLM, SSO, Sauvegardes, Mise à jour)
6. Click une card → section s'ouvre avec bouton **← Paramètres** en haut

## Contraintes respectées

- ✅ Dock minimal (3 items Apps/Plus/Runners — demandé par Mathieu)
- ✅ Accès pratique et clair à tout le reste (sheet organisé)
- ✅ Settings = card grid moderne (comme Apps — demandé par Mathieu)
- ✅ Interface 100% français
- ✅ Aucune mention legacy (Dyad, etc.)
- ✅ Patterns UI cohérents avec Apps + Modal
- ✅ Safe-area et a11y (tap targets, ARIA, keyboard)

---

**Ready for review.** Merge après validation Mathieu.
