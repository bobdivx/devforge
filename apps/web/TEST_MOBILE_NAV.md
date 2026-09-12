# Test plan : Navigation mobile DevForge

**Branche :** `cursor/mobile-nav-ux-fix-b9a8`  
**PR :** https://github.com/bobdivx/devforge/pull/73

## Contexte

Fix de l'UX mobile suite aux retours utilisateur (Mathieu) :
- Dock Apps+Runners incomplet → manque MCP, Tokens, Compte, Admin
- Settings ressemble à l'ancien menu global (chips confuses)
- Avatar menu incomplet

## Checklist de test mobile

### 1. Dock mobile (< 1024px)

Vérifier le dock en bas d'écran :

- [ ] **3 items** : Apps · Plus · Runners
- [ ] **Apps** : actif (surbrillance accent) sur `/app`
- [ ] **Plus** : bouton avec icône `+`, pas de lien
- [ ] **Runners** : actif sur `/app/runners`
- [ ] **Safe-area** : padding-bottom correct sur iPhone/Android

### 2. Sheet "Plus"

Taper le bouton **Plus** du dock :

- [ ] Sheet s'ouvre depuis le bas (animation)
- [ ] Backdrop gris foncé + flou
- [ ] Titre "Menu" + bouton ✕ en haut
- [ ] **Section Outils** :
  - [ ] MCP
  - [ ] Tokens
- [ ] **Section Compte** :
  - [ ] Compte / équipe
- [ ] **Section Instance** :
  - [ ] Paramètres
  - [ ] Mise à jour
  - [ ] Admin (si `instance_admin` seulement)
- [ ] Cibles tactiles min 44px (confortable)
- [ ] Route active surlignée en accent
- [ ] Scroll interne si contenu déborde
- [ ] Safe-area bas respectée
- [ ] Ferme par :
  - [ ] Tap backdrop
  - [ ] Bouton ✕
  - [ ] Tap sur un lien
  - [ ] Touche Escape (desktop)

### 3. Avatar dropdown

Desktop + mobile :

- [ ] **Avant séparateur** :
  - [ ] MCP (nouveau)
  - [ ] Tokens (nouveau)
- [ ] **Séparateur**
- [ ] Compte
- [ ] Paramètres
- [ ] Admin (si admin)
- [ ] Profil GitHub (si connecté)
- [ ] **Séparateur**
- [ ] Déconnexion

### 4. Settings (mobile)

Aller sur `/app/settings/` (responsive < 1024px) :

- [ ] **Label « Sections »** en uppercase faint au-dessus des chips
- [ ] Chips horizontales scroll (Général, Domaine, GitHub, Serveur, LLM, SSO, Sauvegardes, Mise à jour)
- [ ] Chips clairement identifiées comme onglets de page (pas menu global)
- [ ] Active en accent, autres en muted

### 5. Navigation générale mobile

Tester la cohérence sur toutes les pages :

- [ ] `/app` → Dock Apps actif
- [ ] `/app/runners` → Dock Runners actif
- [ ] `/app/mcp` → Accessible depuis Plus sheet
- [ ] `/app/tokens` → Accessible depuis Plus sheet
- [ ] `/app/team` → Accessible depuis Plus sheet + avatar
- [ ] `/app/settings` → Accessible depuis Plus sheet + avatar
- [ ] `/app/admin` → Accessible depuis Plus sheet + avatar (si admin)
- [ ] `/app/update` → Accessible depuis Plus sheet

### 6. Desktop (≥ 1024px)

Vérifier que le desktop est inchangé :

- [ ] Sidebar gauche toujours présente
- [ ] Pas de dock mobile visible
- [ ] Pas de sheet "Plus"
- [ ] Avatar dropdown enrichi (MCP + Tokens ajoutés)

### 7. Accessibilité

- [ ] **Keyboard** :
  - [ ] Tab navigation dans le sheet
  - [ ] Escape ferme le sheet
- [ ] **Screen reader** :
  - [ ] ARIA labels corrects (dialog, modal, current)
  - [ ] Titres h2/h3 structurés
- [ ] **Touch** :
  - [ ] Tous les boutons min 44px
  - [ ] Pas de cibles tactiles trop proches

## Cas limites

- [ ] **iPhone SE (petit écran)** : sheet max 75dvh, scroll OK
- [ ] **iPad paysage (1024px)** : reste mobile ou passe desktop selon viewport
- [ ] **Admin/non-admin** : section Admin visible/cachée correctement
- [ ] **GitHub non connecté** : pas de "Profil GitHub" dans avatar

## Success criteria

✅ Tous les points suivants validés :

1. MCP et Tokens accessibles en ≤2 taps depuis n'importe quelle page mobile
2. Dock minimal (3 items) + sheet pratique pour le reste
3. Settings ne ressemble plus à l'ancien menu global
4. Interface 100% français, zéro mention legacy
5. Safe-area iOS/Android respectée partout
6. Desktop inchangé (sidebar OK)

---

**Validé par :** _________  
**Date :** _________
