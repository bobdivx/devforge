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

✅ Tout accessible en ≤2 taps
✅ Avatar menu enrichi (+ MCP, Tokens)
✅ Settings chips labelisées "Sections" (clarté)
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
2. **`AppShell.tsx`** : intègre `MobileMenuSheet`, labellise chips Settings
3. **`AppHeader.tsx`** : ajoute MCP + Tokens dans avatar dropdown
4. **`SettingsPage.tsx`** : change label "Settings" → "Sections"

## Test

Mobile ou responsive < 1024px :
1. Dock affiche 3 items (Apps · Plus · Runners)
2. Tap Plus → sheet s'ouvre
3. Vérifier accès MCP, Tokens, Compte, Paramètres, Admin
4. Avatar menu contient aussi MCP + Tokens
5. Sur `/app/settings/` → chips précédées du label "Sections"

## Contraintes respectées

- ✅ Dock minimal (3 items max demandé par Mathieu)
- ✅ Accès pratique et clair à tout le reste
- ✅ Interface 100% français
- ✅ Aucune mention legacy (Dyad, etc.)
- ✅ Patterns UI cohérents avec Modal existant
- ✅ Safe-area et a11y (tap targets, ARIA, keyboard)

---

**Ready for review.** Merge après validation Mathieu.
