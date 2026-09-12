# 📱 Résumé visuel PR #73

**DevForge v2 — UX mobile fixes**

---

## Vue d'ensemble des changements

```
┌─────────────────────────────────────────────────────────────┐
│  AVANT (problèmes)                                          │
├─────────────────────────────────────────────────────────────┤
│  1. Dock incomplet : [Apps] [Runners]                      │
│     → MCP, Tokens, Compte, Admin cachés                    │
│                                                             │
│  2. Settings confus : [Général][Domaine][GitHub]...        │
│     → Chips = "ancien menu global"                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  APRÈS (solutions)                                          │
├─────────────────────────────────────────────────────────────┤
│  1. Dock minimal + sheet pratique                          │
│     [Apps] [Plus] [Runners]                                │
│              ↓                                              │
│     Sheet avec MCP, Tokens, Compte, Paramètres, Admin      │
│                                                             │
│  2. Settings = grille de cartes (comme Apps)               │
│     ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                      │
│     │ ⚙️  │ │ 🌍  │ │ GH  │ │ 💾  │                      │
│     └─────┘ └─────┘ └─────┘ └─────┘                      │
│     ... (8 cartes au total)                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Changement 1 : Dock mobile + Sheet "Plus"

### Layout mobile

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  [Avatar]            [Stats]        ┃  ← AppHeader
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                     ┃
┃  Contenu principal                  ┃  ← Page content
┃                                     ┃
┃                                     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ [Apps]   │   [Plus]   │   [Runners] ┃  ← Dock (3 items)
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
              ↓ tap Plus
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Menu                          [×]  ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃  OUTILS                             ┃
┃   ┌───────────────────────────────┐ ┃
┃   │ • MCP                         │ ┃
┃   └───────────────────────────────┘ ┃
┃   ┌───────────────────────────────┐ ┃
┃   │ • Tokens                      │ ┃
┃   └───────────────────────────────┘ ┃
┃                                     ┃
┃  COMPTE                             ┃
┃   ┌───────────────────────────────┐ ┃
┃   │ • Compte / équipe             │ ┃
┃   └───────────────────────────────┘ ┃
┃                                     ┃
┃  INSTANCE                           ┃
┃   ┌───────────────────────────────┐ ┃
┃   │ • Paramètres                  │ ┃
┃   └───────────────────────────────┘ ┃
┃   ┌───────────────────────────────┐ ┃
┃   │ • Mise à jour                 │ ┃
┃   └───────────────────────────────┘ ┃
┃   ┌───────────────────────────────┐ ┃
┃   │ • Admin (si admin)            │ ┃
┃   └───────────────────────────────┘ ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
     MobileMenuSheet (max 75dvh)
```

**Résultat :**
- MCP, Tokens accessibles en 2 taps
- Dock reste minimal (3 items)
- Sheet organisé par sections logiques

---

## Changement 2 : Settings card grid

### Page Settings root (`/app/settings`)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Paramètres                                                   ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                               ┃
┃  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       ┃
┃  │  ⚙️          │  │  🌍          │  │              │       ┃
┃  │              │  │              │  │   GitHub     │       ┃
┃  │   Général    │  │   Domaine    │  │              │       ┃
┃  │              │  │              │  │   Connexion  │       ┃
┃  │  État du     │  │  Wildcard    │  │   API GitHub │       ┃
┃  │  serveur...  │  │  domain...   │  │   (token)    │       ┃
┃  └──────────────┘  └──────────────┘  └──────────────┘       ┃
┃                                                               ┃
┃  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       ┃
┃  │  💾          │  │  🧠          │  │  🛡️          │       ┃
┃  │              │  │              │  │              │       ┃
┃  │   Serveur    │  │  Agents/LLM  │  │  SSO / OIDC  │       ┃
┃  │              │  │              │  │              │       ┃
┃  │  Docker ou   │  │  Providers   │  │  Auth unique │       ┃
┃  │  SSH...      │  │  IA...       │  │  (OIDC)      │       ┃
┃  └──────────────┘  └──────────────┘  └──────────────┘       ┃
┃                                                               ┃
┃  ┌──────────────┐  ┌──────────────┐                         ┃
┃  │  📦          │  │  🔄          │                         ┃
┃  │              │  │              │                         ┃
┃  │ Sauvegardes  │  │ Mise à jour  │                         ┃
┃  │              │  │              │                         ┃
┃  │  Backup      │  │  DevForge    │                         ┃
┃  │  automatique │  │  version...  │                         ┃
┃  └──────────────┘  └──────────────┘                         ┃
┃                                                               ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Grid : 2 colonnes (mobile) → 3-4 colonnes (tablet/desktop)
Chaque card cliquable → ouvre la section
```

### Section détail (ex: `?tab=github`)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ┌───┐                                                        ┃
┃  │ ← │  GitHub                                                ┃
┃  └───┘                                                        ┃
┃  Bouton retour → /app/settings                               ┃
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
┃                                                               ┃
┃  ┌─────────────────────────────────────────────────────────┐ ┃
┃  │ GitHub                            ✅ Connecté           │ ┃
┃  ├─────────────────────────────────────────────────────────┤ ┃
┃  │                                                         │ ┃
┃  │  @bobdivx                                               │ ┃
┃  │  Bob Divx                                               │ ┃
┃  │                                                         │ ┃
┃  │  [Profil]  [Déconnecter]                               │ ┃
┃  │                                                         │ ┃
┃  └─────────────────────────────────────────────────────────┘ ┃
┃                                                               ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Plus de chips horizontales !
Navigation : grille → section → [← retour] → grille
```

**Résultat :**
- Découverte intuitive (visual, pas de scroll horizontal)
- Plus de confusion avec "ancien menu global"
- Cohérence avec la page Apps
- Navigation claire (grille = home)

---

## Comparaison side-by-side

```
┌─────────────────────────────┬─────────────────────────────┐
│  AVANT : Chips confuses     │  APRÈS : Grille claire      │
├─────────────────────────────┼─────────────────────────────┤
│                             │                             │
│  /app/settings/             │  /app/settings/             │
│  ─────────────────────────  │                             │
│  [Gén][Dom][GH][Srv]...     │  ┌─────┐ ┌─────┐ ┌─────┐   │
│   ↑                         │  │ ⚙️  │ │ 🌍  │ │ GH  │   │
│  Chips scroll horizontal    │  └─────┘ └─────┘ └─────┘   │
│  = confusion "ancien menu"  │  ... (8 cartes)             │
│                             │   ↑                         │
│  Découverte difficile       │  Grille moderne (comme Apps)│
│  (scroll requis)            │  Tout visible en un coup    │
│                             │                             │
└─────────────────────────────┴─────────────────────────────┘
```

---

## Avatar menu enrichi

```
AVANT :                    APRÈS :
──────────────────────    ──────────────────────
[Avatar ▾]                [Avatar ▾]
  • Compte                  • MCP           ← NOUVEAU
  • Admin (si admin)        • Tokens        ← NOUVEAU
  • Paramètres              ────────────
  • GitHub                  • Compte
  ────────────              • Paramètres
  • Déconnexion             • Admin (si admin)
                            • Profil GitHub
                            ────────────
                            • Déconnexion
```

---

## Metrics : Taps pour atteindre

| Page        | Avant              | Après    |
|-------------|--------------------|----------|
| MCP         | ❌ Inconnu (caché) | ✅ 2 taps |
| Tokens      | ❌ Inconnu (caché) | ✅ 2 taps |
| Paramètres  | ❌ Complexe        | ✅ 2 taps |
| Compte      | ❌ 2-3 taps        | ✅ 2 taps |
| Admin       | ❌ Complexe        | ✅ 2 taps |

**Flow type :**
```
Page /app
  → Tap [Plus]
  → Tap [MCP]
  → /app/mcp
```

---

## Responsive behavior

### Mobile (< 1024px)

- ✅ Dock 3 items visible
- ✅ Sheet "Plus" disponible
- ✅ Settings = grille 2 colonnes
- ✅ Avatar enrichi (+ MCP, Tokens)

### Desktop (≥ 1024px)

- ✅ Sidebar gauche visible
- ✅ Dock masqué
- ✅ Settings = grille 3-4 colonnes
- ✅ Avatar enrichi (+ MCP, Tokens)

---

## Cohérence UI globale

Toutes les pages principales utilisent maintenant le **même visual language** :

| Page     | Layout       | Style                    |
|----------|--------------|--------------------------|
| Apps     | Card grid    | rounded-2xl, hover ring  |
| Settings | Card grid    | rounded-2xl, hover ring  |
| Sheet    | Bottom sheet | Modal pattern, safe-area |

**Résultat :** UX cohérente, moderne, familière pour l'utilisateur.

---

## Test rapide (checklist express)

**Mobile :**
- [ ] Dock : Apps · Plus · Runners
- [ ] Tap Plus → sheet s'ouvre
- [ ] Sheet : 3 sections (Outils, Compte, Instance)
- [ ] MCP + Tokens dans sheet
- [ ] `/app/settings` → grille 8 cartes
- [ ] Click card → section avec bouton ← Paramètres

**Desktop :**
- [ ] Sidebar présente
- [ ] Avatar menu contient MCP + Tokens
- [ ] Settings grille 3-4 colonnes

---

## Liens documentation

1. **[MOBILE_NAV_FIX.md](./MOBILE_NAV_FIX.md)** — Résumé technique global
2. **[SETTINGS_CARD_GRID.md](./SETTINGS_CARD_GRID.md)** — Doc Settings card grid détaillée
3. **[TEST_MOBILE_NAV.md](./apps/web/TEST_MOBILE_NAV.md)** — Plan de test complet
4. **[VISUAL_GUIDE_MOBILE_NAV.md](./VISUAL_GUIDE_MOBILE_NAV.md)** — Schémas détaillés
5. **[RECAP_PR_73.md](./RECAP_PR_73.md)** — Récapitulatif complet PR

---

**PR :** https://github.com/bobdivx/devforge/pull/73  
**Branche :** `cursor/mobile-nav-ux-fix-b9a8`  
**Status :** 🟡 Draft — Ready for review Mathieu
