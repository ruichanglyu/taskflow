# TaskFlow UI/UX Revamp Plan

**Goal**: Keep all features, restyle everything to be clean, minimal, and spacious — inspired by Morgen's planner UI.

**Core principle**: Reduce visual weight everywhere. Fewer shadows, less rounding, no gradient-filled icon boxes, more whitespace, slimmer sidebar.

---

## Styling Rules (apply globally)

| Before | After |
|--------|-------|
| `rounded-2xl` (16px) | `rounded-lg` (8px) — reserve `rounded-xl` for modals only |
| `shadow-lg`, `shadow-2xl`, inline `boxShadow` | `shadow-sm` or no shadow |
| `backdrop-blur-xl` on sidebar/header | Solid opaque backgrounds |
| Gradient icon boxes (`var(--sidebar-gradient)`) | Simple accent color or no background |
| Heavy bordered card-in-card nesting | Single border or whitespace separation |
| `w-72` sidebar with labels | `w-14` icon-only sidebar (desktop), `w-64` overlay (mobile) |

---

## Phase 1: Sidebar → Slim Icon Rail
**File**: `src/components/Sidebar.tsx`

- Desktop: `w-14` permanently, icon-only, centered vertically
- Mobile: keep existing `w-64` slide-out overlay with labels (already works)
- Logo: just the Zap icon, no gradient box, no shadow, no "TaskFlow" text
- Nav items: bare icon buttons (`w-10 h-10 rounded-lg`), no icon container boxes
- Active state: `bg-[var(--accent-soft)] text-[var(--accent)]` + left accent bar (2px)
- Hover: subtle `bg-[var(--surface-muted)]`
- Canvas button: icon only
- User footer: small avatar only (`h-8 w-8 rounded-full`), no card wrapper
- Remove all `backgroundImage: var(--sidebar-gradient)` and inline `boxShadow`
- Add `title` attributes on each icon for tooltip on hover

---

## Phase 2: AppShell Header → Cleaner Toolbar
**File**: `src/components/AppShell.tsx` (lines 688-743)

- Remove `backdrop-blur-xl`, use `bg-[var(--bg-app)]` (opaque)
- Search: `rounded-lg`, no shadow
- Header buttons (Routines, AI, Log out): `rounded-lg`, no shadow, thinner borders
- Reduce padding: `py-3` instead of `py-4`
- Error/sync banners: `rounded-lg` instead of `rounded-2xl`
- Adjust `main` padding since sidebar is now slimmer — more content breathing room

---

## Phase 3: Theme Switcher → Dropdown
**Files**: `src/components/ThemeSwitcher.tsx`, `src/components/ThemeSettings.tsx`

Replace the full slide-out panel with a compact dropdown popover:

**Dropdown layout** (~280px wide):
```
┌─────────────────────────────┐
│  Light    Dark    System    │  ← 3 thumbnail cards
│  [  ]     [  ]    [  ]      │
│                             │
│  Colors                     │
│  ● ● ● ● ● ● ●            │  ← small palette circles
│                             │
│  Font size    [—slider—]    │
│  Font         Inter ▾       │  ← compact dropdown
└─────────────────────────────┘
```

- Mode: three mini-preview thumbnails (Light/Dark/System), active gets accent border
- Add `'system'` mode to `useTheme` — listens to `prefers-color-scheme`
- Palette: row of `h-6 w-6 rounded-full` circles, checkmark on active
- Font + size: compact row, not full-width cards
- Position: anchored below the trigger button, click-outside to close
- No portal, no backdrop overlay

---

## Phase 4: useTheme → Add System Mode
**File**: `src/hooks/useTheme.tsx`

- Extend `ModeId` to `'light' | 'dark' | 'system'`
- When `'system'`, listen to `matchMedia('(prefers-color-scheme: dark)')` changes
- Resolve effective mode (light/dark) before applying `data-mode` attribute
- Store `'system'` in localStorage so it persists

---

## Phase 5: CSS Variables Cleanup
**File**: `src/index.css`

- Zero out `--shadow-color` and `--glow-accent` / `--glow-warm`
- Make `--bg-app-soft` fully opaque (no more rgba transparency)
- Keep all palette definitions intact

---

## Phase 6: Component Pass (apply styling rules to all pages)

**High priority** (seen daily):
- [ ] `Dashboard.tsx` — stat cards, study blocks
- [ ] `TaskBoard.tsx` — kanban columns, task cards
- [ ] `CalendarView.tsx` — calendar chrome, event cards
- [ ] `DeadlinesPage.tsx` — deadline list items
- [ ] `ProjectList.tsx` — course cards

**Medium priority**:
- [ ] `AIPanel.tsx` — chat panel, import blocks
- [ ] `HabitsPanel.tsx` — habits floating panel
- [ ] `GymPage.tsx` — workout cards, session UI

**Lower priority** (modals, less frequent):
- [ ] `GlobalSearch.tsx` — search modal
- [ ] `AddTaskModal.tsx` / `EditTaskModal.tsx` — task modals
- [ ] `CreateEventModal.tsx` — calendar event modal
- [ ] `ProfileModal.tsx` — profile settings
- [ ] `CanvasConnect.tsx` — canvas setup
- [ ] `AuthScreen.tsx` / `ResetPasswordScreen.tsx` — auth pages
- [ ] `TimelineView.tsx` — gantt/timeline
- [ ] `CalendarGrid.tsx` — mini calendar widget

**Pattern for each file**:
1. `rounded-2xl` → `rounded-lg`
2. Remove `shadow-lg`, `shadow-2xl`, inline `boxShadow`, `style={{ boxShadow: ... }}`
3. Remove `backdrop-blur-xl`
4. Remove gradient backgrounds on UI chrome
5. Simplify card-in-card nesting to single bordered containers
6. Add more whitespace between sections

---

## Order of Execution

1. Phase 1 (Sidebar) — biggest visual impact, single file
2. Phase 2 (Header) — second biggest impact, same session
3. Phase 3+4 (Theme dropdown + system mode) — user specifically requested this
4. Phase 5 (CSS cleanup) — safety net for remaining references
5. Phase 6 (All components) — systematic pass, one file at a time

---

## Things NOT to change
- All features stay (AI panel, habits, gym, canvas, calendar, etc.)
- CSS variable theming system stays
- All palette options stay
- Mobile responsive behavior stays
- React Router structure stays
- No dependency additions (no tooltip library, no popover library)
