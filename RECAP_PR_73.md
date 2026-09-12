# 📱 Récapitulatif PR #73 : Fix navigation mobile DevForge

**Branche :** [`cursor/mobile-nav-ux-fix-b9a8`](https://github.com/bobdivx/devforge/tree/cursor/mobile-nav-ux-fix-b9a8)  
**Pull Request :** [#73](https://github.com/bobdivx/devforge/pull/73)  
**Statut :** 🟡 Draft — En attente review Mathieu

---

## 🎯 Objectif

Corriger l'UX mobile confuse de DevForge v2 :
- MCP, Tokens, Compte, Admin difficiles à atteindre (pas dans dock)
- Settings ressemble à l'ancien menu global
- Avatar menu incomplet

## ✅ Solution implémentée

### 1. Dock mobile Apps · Plus · Runners (3 items)

- **Apps** → `/app` (liste applications)
- **Plus** → ouvre bottom sheet (nouveau)
- **Runners** → `/app/runners`

### 2. Bottom sheet "Plus" pratique

Composant `MobileMenuSheet` avec sections :
- **Outils** : MCP, Tokens
- **Compte** : Compte / équipe
- **Instance** : Paramètres, Mise à jour, Admin

Safe-area, scroll, tap targets 44px, highlight route active.

### 3. Avatar enrichi (MCP + Tokens ajoutés)

Desktop + mobile : inclut maintenant toutes les pages principales.

### 4. Settings : grille de cartes (comme Apps) 🆕

**Changement majeur selon feedback Mathieu :**

`/app/settings` affiche une **grille de 8 cartes** au lieu de chips horizontales :
- Général, Domaine, GitHub, Serveur, Agents/LLM, SSO/OIDC, Sauvegardes, Mise à jour
- Chaque carte : icône, titre, description courte en français
- Visual language identique à `/app` (rounded-2xl, hover effects, aspect-square)
- Click card → section s'ouvre avec bouton **← Paramètres** (retour à la grille)

**Résultat :**
- Plus de chips confuses = "ancien menu global"
- Navigation claire : grille → section → retour
- Cohérence UI avec la page Apps

---

## 📂 Fichiers modifiés

| Fichier                                  | Type      | Description                              |
|------------------------------------------|-----------|------------------------------------------|
| `apps/web/src/components/MobileMenuSheet.tsx` | ✨ Nouveau | Bottom sheet mobile pour accès rapide    |
| `apps/web/src/lib/nav.ts`                | 📝 Modifié | `mobileBottomNav()` + doc                |
| `apps/web/src/components/AppShell.tsx`   | 🔧 Modifié | Intégration sheet + `title` JSX          |
| `apps/web/src/components/AppHeader.tsx`  | 🔧 Modifié | Avatar enrichi (+ MCP, Tokens)           |
| `apps/web/src/components/SettingsPage.tsx` | 🎨 Modifié | **Grille de cartes** au lieu de chips    |
| `MOBILE_NAV_FIX.md`                      | 📚 Doc     | Résumé technique du fix                  |
| `apps/web/TEST_MOBILE_NAV.md`            | ✅ Test    | Plan de test complet (checklist)         |
| `VISUAL_GUIDE_MOBILE_NAV.md`             | 📊 Guide   | Schémas et flows utilisateur             |

**Stats :** +649 lignes, -5635 lignes (cleanup + card grid)

---

## 🔗 Documentation associée

1. **[MOBILE_NAV_FIX.md](./MOBILE_NAV_FIX.md)** — Résumé technique (avant/après, architecture)
2. **[TEST_MOBILE_NAV.md](./apps/web/TEST_MOBILE_NAV.md)** — Plan de test avec checklist complète
3. **[VISUAL_GUIDE_MOBILE_NAV.md](./VISUAL_GUIDE_MOBILE_NAV.md)** — Schémas visuels et flows

---

## 🧪 Test rapide (mobile < 1024px)

```bash
# 1. Checkout la branche
git checkout cursor/mobile-nav-ux-fix-b9a8

# 2. Build + run
cd apps/web
npm install
npm run dev

# 3. Ouvrir en responsive mobile
# → http://localhost:8080/app
```

**Checklist express :**
- [ ] Dock : 3 items (Apps · Plus · Runners)
- [ ] Tap **Plus** → sheet s'ouvre
- [ ] Vérifier MCP + Tokens dans sheet
- [ ] Avatar menu contient aussi MCP + Tokens
- [ ] Sur `/app/settings/` → label "Sections" visible

---

## 📊 Résultats attendus

| Critère                                      | Avant | Après |
|----------------------------------------------|-------|-------|
| Taps pour atteindre MCP depuis `/app`       | ❌ Inconnu (pas visible) | ✅ 2 taps |
| Taps pour atteindre Tokens depuis `/app`    | ❌ Inconnu | ✅ 2 taps |
| Taps pour atteindre Settings                 | ❌ Complexe | ✅ 2 taps |
| Dock items                                   | 2 (Apps, Runners) | 3 (Apps, Plus, Runners) |
| Settings UX                                  | ❌ Chips confuses (ancien menu) | ✅ Grille de cartes (comme Apps) |
| Avatar contient MCP + Tokens                 | ❌ Non | ✅ Oui |
| Interface français                           | ✅ Oui | ✅ Oui |
| Safe-area iOS/Android                        | ⚠️ Partiel | ✅ Complet |
| Cibles tactiles min 44px                     | ⚠️ Partiel | ✅ Complet |

---

## 🚀 Prochaines étapes

### Review

1. **Mathieu (@bobdivx)** : test mobile sur device réel
2. Vérifier flow : Apps → Plus → MCP/Tokens
3. **Nouveau :** Vérifier Settings = grille de cartes (8 cartes, bouton retour)
4. Valider desktop inchangé

### Après validation

```bash
# Marquer ready for review
gh pr ready 73

# Ou via GitHub UI :
# → Draft → Ready for review
```

### Merge

```bash
# Via GitHub UI (recommandé)
# → Squash and merge (commits propres)

# Ou CLI :
gh pr merge 73 --squash --delete-branch
```

---

## 📞 Contact

**Auteur :** Cloud Agent Cursor  
**Requête :** Mathieu via screenshot mobile + feedback UX  
**Date :** 2026-09-12  

**Questions / modifications :** Commenter directement sur [PR #73](https://github.com/bobdivx/devforge/pull/73)

---

## 🎨 Preview visuel

```
AVANT :
┌──────────────────────┐
│  [Apps] [Runners]    │  ← Incomplet
└──────────────────────┘

APRÈS :
┌────────────────────────────┐
│  [Apps] [Plus] [Runners]   │  ← Minimal + pratique
└────────────────────────────┘
              ↓ tap
     ┌─────────────────┐
     │  Menu           │
     │  • MCP          │
     │  • Tokens       │
     │  • Compte       │
     │  • Paramètres   │
     │  • Mise à jour  │
     │  • Admin        │
     └─────────────────┘
```

Voir [VISUAL_GUIDE_MOBILE_NAV.md](./VISUAL_GUIDE_MOBILE_NAV.md) pour schémas complets.

---

**Dernière mise à jour :** commit `21809f8f5`  
**Validation :** 🟡 En attente Mathieu
