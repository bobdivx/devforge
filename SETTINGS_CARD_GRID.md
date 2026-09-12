# Settings : Grille de cartes (comme Apps)

**Changement majeur dans PR #73** selon feedback Mathieu.

---

## Problème

Les chips horizontales sur `/app/settings/` ressemblaient à un "ancien menu global" et désorientaient les utilisateurs.

```
AVANT (/app/settings/) :
─────────────────────────────────────────
[Général] [Domaine] [GitHub] [Serveur] [LLM] ...
← Chips scroll horizontal = confusion
```

---

## Solution : Card Grid (visual, moderne)

`/app/settings` (root) affiche maintenant une **grille de cartes** identique au style de `/app` (Apps).

```
APRÈS (/app/settings/) :

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  ⚙️          │  │  🌍          │  │  GitHub      │  │  💾          │
│  Général     │  │  Domaine     │  │  Connexion   │  │  Serveur     │
│  État...     │  │  Wildcard... │  │  API GitHub  │  │  Docker...   │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  🧠          │  │  🛡️          │  │  📦          │  │  🔄          │
│  Agents/LLM  │  │  SSO / OIDC  │  │  Sauvegardes │  │  Mise à jour │
│  Providers   │  │  Auth unique │  │  Backup auto │  │  DevForge... │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘

Grille 2-4 colonnes (responsive), aspect-square, hover effects
```

---

## Navigation

### Vue grille (root)

- URL : `/app/settings` (sans `?tab=...`)
- Affiche 8 cartes
- Click une carte → ouvre la section

### Vue section (détail)

- URL : `/app/settings?tab=github` (exemple)
- Bouton **← Paramètres** en haut à gauche (retour à la grille)
- Contenu de la section (formulaires, status, etc.)
- Plus de chips horizontales

**Flow :**
```
/app/settings (grille)
  ↓ click "GitHub"
/app/settings?tab=github (section)
  ↓ click "← Paramètres"
/app/settings (grille)
```

---

## Metadata des cartes

```tsx
const SETTINGS_CARDS: SettingCardMeta[] = [
  {
    key: 'general',
    title: 'Général',
    description: 'État du serveur, connexions, base de données',
    icon: 'settings',
  },
  {
    key: 'domaine',
    title: 'Domaine',
    description: 'Wildcard domain pour les sous-domaines apps',
    icon: 'globe',
  },
  {
    key: 'github',
    title: 'GitHub',
    description: 'Connexion API GitHub (token PAT)',
    icon: 'github',
  },
  {
    key: 'serveur',
    title: 'Serveur',
    description: 'Docker local ou SSH distant, clés SSH',
    icon: 'server',
  },
  {
    key: 'llm',
    title: 'Agents / LLM',
    description: 'Providers IA (OpenAI, Anthropic, local)',
    icon: 'brain',
  },
  {
    key: 'sso',
    title: 'SSO / OIDC',
    description: 'Authentification unique (OIDC)',
    icon: 'shield',
  },
  {
    key: 'backup',
    title: 'Sauvegardes',
    description: 'Stratégie de backup automatique',
    icon: 'archive',
  },
  {
    key: 'update',
    title: 'Mise à jour',
    description: 'Mise à jour de DevForge vers la dernière version',
    icon: 'refresh',
  },
];
```

---

## Composants

### `SettingsIcon({ icon })`

Composant d'icônes SVG pour chaque section (settings, globe, github, server, brain, shield, archive, refresh).

### `SettingCard({ card, index })`

Card component avec :
- FadeIn animation (delay progressif)
- Icône centrée (bg accent-soft)
- Titre + description
- Hover effects (translate-y, ring)
- Link vers `/app/settings?tab=${card.key}`

### Logique dans `SettingsPage`

```tsx
const section = readSection(); // null ou 'general' | 'domaine' | etc.

if (!section) {
  // Affiche la grille de cartes
  return (
    <AppShell active="settings" title="Paramètres">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
        {SETTINGS_CARDS.map((card, i) => (
          <SettingCard key={card.key} card={card} index={i} />
        ))}
      </div>
    </AppShell>
  );
}

// Sinon, affiche la section avec bouton retour
return (
  <AppShell
    active="settings"
    title={
      <div class="flex items-center gap-3">
        <a href="/app/settings" ...>
          ← (icône flèche)
        </a>
        <span>{SECTION_TITLES[section]}</span>
      </div>
    }
  >
    {/* Contenu section */}
  </AppShell>
);
```

---

## Cohérence avec Apps

| Propriété         | Apps (`/app`)       | Settings (`/app/settings`) |
|-------------------|---------------------|---------------------------|
| Layout            | Grid 2-5 colonnes   | Grid 2-4 colonnes          |
| Card aspect       | aspect-square       | aspect-square              |
| Card style        | rounded-2xl, bg-[#1c1c1e] | rounded-2xl, bg-[#1c1c1e] |
| Hover effect      | translate-y, ring   | translate-y, ring          |
| Animation         | FadeIn delay        | FadeIn delay               |
| Icône position    | Centrée, grande     | Centrée, grande            |
| Titre + detail    | Nom + status        | Titre + description        |

**Résultat :** visual language unifié → utilisateur comprend immédiatement le pattern.

---

## Avantages

✅ **Découverte intuitive** : toutes les sections visibles en un coup d'œil (pas de scroll horizontal)  
✅ **Plus de confusion** : grille ≠ menu global, c'est clairement une page avec des options  
✅ **Cohérence UI** : même style que Apps (familier pour l'utilisateur)  
✅ **Navigation claire** : grille → section → retour (pas de "je suis où ?")  
✅ **Extensible** : facile d'ajouter une nouvelle card (metadata + icône)  
✅ **Accessible** : cibles tactiles grandes (aspect-square), hover states, keyboard nav

---

## Test

### 1. Root `/app/settings`

- [ ] Grille de 8 cartes affichée
- [ ] Responsive : 2 colonnes (mobile) → 3-4 colonnes (desktop)
- [ ] Hover : card translate-y + ring
- [ ] FadeIn animation progressive

### 2. Click une card (ex: GitHub)

- [ ] Navigation vers `/app/settings?tab=github`
- [ ] Bouton **← Paramètres** visible en haut à gauche
- [ ] Plus de chips horizontales

### 3. Retour à la grille

- [ ] Click **← Paramètres**
- [ ] Retour à `/app/settings` (root, grille affichée)

### 4. Desktop vs Mobile

- [ ] Desktop : grid 3-4 colonnes, sidebar gauche visible
- [ ] Mobile : grid 2 colonnes, dock visible, pas de sidebar

---

## Maintenance future

### Ajouter une section

1. Ajouter dans `SettingsSection` type :
   ```ts
   type SettingsSection = '...' | 'nouvelle-section';
   ```

2. Ajouter dans `SETTINGS_CARDS` :
   ```ts
   {
     key: 'nouvelle-section',
     title: 'Nouveau titre',
     description: 'Description courte en français',
     icon: 'existing-icon-or-add-new',
   }
   ```

3. Ajouter l'icône dans `SettingsIcon()` si nouvelle

4. Ajouter le cas dans le switch de `SettingsPage` :
   ```tsx
   {section === 'nouvelle-section' && (
     <FadeIn>
       {/* Contenu section */}
     </FadeIn>
   )}
   ```

### Modifier une card

Éditer `SETTINGS_CARDS` : changer `title`, `description`, ou `icon`.

---

**Implémenté dans :** PR #73, commit `cda1aef81`  
**Feedback Mathieu :** ✅ Validé (grille pratique comme Apps)  
**Documentation :** SETTINGS_CARD_GRID.md (ce fichier)
