# Guide visuel : Navigation mobile DevForge v2

**PR #73** — Branch `cursor/mobile-nav-ux-fix-b9a8`

---

## Vue d'ensemble

```
┌─────────────────────────────────────┐
│  [Avatar]              [Stats]      │  ← AppHeader (inchangé)
├─────────────────────────────────────┤
│                                     │
│  Contenu principal                  │  ← Main content
│                                     │
│                                     │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  [Apps]  │  [Plus]  │  [Runners]   │  ← Nouveau dock (3 items)
└─────────────────────────────────────┘
      ↓
      Tap Plus
      ↓
┌─────────────────────────────────────┐
│  Menu                          [×]  │
├─────────────────────────────────────┤
│  OUTILS                             │
│    • MCP                            │
│    • Tokens                         │
│                                     │
│  COMPTE                             │
│    • Compte / équipe                │
│                                     │
│  INSTANCE                           │
│    • Paramètres                     │
│    • Mise à jour                    │
│    • Admin (si admin)               │
└─────────────────────────────────────┘
       Bottom Sheet ↑
```

---

## Comparaison Avant / Après

### AVANT (problème)

```
Dock mobile :
┌────────────────────────────┐
│  [Apps]  │  [Runners]      │  ← Seulement 2 items
└────────────────────────────┘

❌ MCP, Tokens, Compte, Paramètres, Admin
   → difficiles à atteindre (pas dans dock, avatar incomplet)

❌ Settings chips = confusion
   → "ancien menu global" selon utilisateur
```

### APRÈS (fix)

```
Dock mobile :
┌────────────────────────────────────┐
│  [Apps]  │  [Plus]  │  [Runners]  │  ← 3 items
└────────────────────────────────────┘
              ↓
         Tap Plus
              ↓
      ┌─────────────────┐
      │ Menu pratique   │  ← Sheet avec tout le reste
      │ • MCP           │
      │ • Tokens        │
      │ • Compte        │
      │ • Paramètres    │
      │ • Mise à jour   │
      │ • Admin         │
      └─────────────────┘

✅ Tout accessible en ≤2 taps
✅ Settings chips labelisées "Sections"
✅ Avatar enrichi (+ MCP, Tokens)
```

---

## Anatomie du MobileMenuSheet

```
┌──────────────────────────────────────────┐
│  Menu                               [×]  │  ← Header (sticky)
├──────────────────────────────────────────┤  ← Border
│  ↕ OUTILS                                │  ← Section 1
│    ┌──────────────────────────────────┐ │
│    │ • MCP                            │ │  ← Item (44px min)
│    └──────────────────────────────────┘ │
│    ┌──────────────────────────────────┐ │
│    │ • Tokens                         │ │
│    └──────────────────────────────────┘ │
│                                          │
│  ↕ COMPTE                                │  ← Section 2
│    ┌──────────────────────────────────┐ │
│    │ • Compte / équipe                │ │
│    └──────────────────────────────────┘ │
│                                          │
│  ↕ INSTANCE                              │  ← Section 3
│    ┌──────────────────────────────────┐ │
│    │ • Paramètres                     │ │
│    └──────────────────────────────────┘ │
│    ┌──────────────────────────────────┐ │
│    │ • Mise à jour                    │ │
│    └──────────────────────────────────┘ │
│    ┌──────────────────────────────────┐ │
│    │ • Admin (si role=instance_admin) │ │
│    └──────────────────────────────────┘ │
│                                          │
│    (scroll si déborde)                   │
│                                          │
└──────────────────────────────────────────┘
↑                                          ↑
Max 75dvh                         Safe-area bottom
```

**Propriétés :**
- `z-index: 50` (au-dessus du dock z-20)
- Backdrop : `bg-black/60 backdrop-blur-sm`
- Rounded top : `rounded-t-2xl`
- Scroll interne avec `overflow-y-auto`
- Tap targets : `min-h-[44px]`
- Fermeture : backdrop, ×, Escape, ou tap item

---

## Avatar dropdown enrichi

### Avant
```
[Avatar ▾]
  • Compte
  • Admin (si admin)
  • Paramètres
  • GitHub
  ────────
  • Déconnexion
```

### Après
```
[Avatar ▾]
  • MCP           ← NOUVEAU
  • Tokens        ← NOUVEAU
  ────────
  • Compte
  • Paramètres
  • Admin (si admin)
  • Profil GitHub
  ────────
  • Déconnexion
```

---

## Settings : chips clarifiées

### Avant (confus)
```
/app/settings/
─────────────────────────────────
[Général] [Domaine] [GitHub] ...   ← Chips sans contexte
                                      = confusion "menu global"
```

### Après (clair)
```
/app/settings/
─────────────────────────────────
SECTIONS                           ← Label explicite
[Général] [Domaine] [GitHub] ...   ← Clairement des onglets de page
```

---

## Responsive behavior

### Mobile (< 1024px)

- ✅ Dock 3 items visible
- ✅ Sheet "Plus" disponible
- ✅ Sidebar masquée
- ✅ Settings chips avec label "Sections"

### Desktop (≥ 1024px)

- ✅ Sidebar gauche visible
- ✅ Dock masqué
- ✅ Sheet "Plus" masqué
- ✅ Avatar enrichi (MCP + Tokens)
- ✅ Settings chips sans label (pas de confusion desktop)

---

## Accessibilité (a11y)

| Critère                  | Implémentation                    |
|--------------------------|-----------------------------------|
| **Touch targets**        | Min 44px (WCAG AAA)               |
| **Keyboard nav**         | Tab, Escape                       |
| **Screen reader**        | ARIA `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-current` |
| **Focus management**     | Trap focus dans sheet             |
| **Safe-area**            | `env(safe-area-inset-bottom)`     |
| **Contrast**             | Accent colors accessibles         |

---

## État de route active

**Dock :**
```tsx
active === 'home'      → Apps surlignés
active === 'runners'   → Runners surlignés
active === 'mcp' etc.  → Rien (accès via Plus)
```

**Sheet :**
```tsx
active === 'mcp'       → MCP surlignés (bg-accent-soft)
active === 'tokens'    → Tokens surlignés
active === 'settings'  → Paramètres surlignés
// etc.
```

---

## Flow utilisateur type

### Scénario 1 : Accéder aux tokens

1. Page `/app` (Apps active dans dock)
2. Tap **Plus**
3. Sheet s'ouvre
4. Tap **Tokens**
5. Navigation vers `/app/tokens`
6. Sheet se ferme automatiquement
7. Dock reste visible (Plus pas actif, Tokens pas dans dock)

**Résultat : 2 taps** ✅

### Scénario 2 : Configurer SSO

1. N'importe quelle page
2. Tap **Plus**
3. Tap **Paramètres**
4. Page `/app/settings/` s'ouvre
5. Voir label "SECTIONS" au-dessus des chips
6. Tap chip **SSO / OIDC**
7. Formulaire SSO affiché

**Résultat : 3 taps** ✅

---

## Cohérence UI

Tous les éléments réutilisent les patterns existants :

- **MobileMenuSheet** : inspiré de `Modal.tsx` (safe-area, backdrop, rounded-t-2xl)
- **Cibles tactiles** : `min-h-[44px]` (même standard que dock)
- **Couleurs** : `var(--color-accent-soft)`, `var(--color-ink-muted)`, etc.
- **Typographie** : `text-sm`, `text-[11px] uppercase tracking-[0.14em]`, etc.

---

## Maintenance future

### Ajouter une nouvelle page principale

1. Ajouter dans `GLOBAL_NAV` (`nav.ts`)
2. Ajouter dans `buildSections()` de `MobileMenuSheet`
3. Décider section : Outils / Compte / Instance
4. Tester le flow mobile

### Modifier le dock

Modifier `mobileBottomNav()` dans `nav.ts` :

```ts
export function mobileBottomNav(): NavItem[] {
  return [
    { href: '/app', label: 'Apps', key: 'home' },
    { href: '#plus', label: 'Plus', key: 'plus' },
    { href: '/app/runners', label: 'Runners', key: 'runners' },
    // Ajouter ici si besoin (max 4 items recommandé)
  ];
}
```

---

**Dernière mise à jour :** PR #73, commit `33b684bda`  
**Auteur :** Cloud Agent Cursor  
**Validation :** En attente review Mathieu (@bobdivx)
