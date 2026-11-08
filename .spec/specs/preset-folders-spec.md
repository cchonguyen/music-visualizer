# Stage 10: Preset Folders & Organization System Specification
<!-- Coords: [400, 410, 486] -->

## 1. Overview & Architectural Motivation

As the visualizer has expanded across Stages 1–9, the preset catalog has grown from a handful of initial prototypes to **41 built-in presets** plus arbitrary user-created presets.
Previously, preset selection in `src/studio/studio.ts` relied on a single flat `<select>` list displaying all presets in insertion order with a minimal ` (yours)` suffix for user presets. This flat model has several critical limitations:
1. **Visual Clutter & Cognitive Overload:** Browsing 41+ presets in a single unorganized list makes discovering new generative presets or finding classic favorites cumbersome.
2. **Lack of User Curatorial Power:** Users cannot organize their presets by vibe, music genre, project, or performance set.
3. **No Separation of Immutable vs. Mutable Assets:** System factory presets are mixed directly with user presets in the selection dropdown without visual hierarchy.

Stage 10 introduces a structured **Two-Tier Categorical Taxonomy** and **Folder Organization Engine**:
- **System Presets (Top Category):** Read-only, factory-curated presets partitioned cleanly into three thematic subfolders (`Stage 9 Showcase (13–20)`, `Flagship Generative (01–12)`, and `Classics & Textures`). System presets can never be overwritten, renamed, moved, or deleted, but user playback metadata (`favourite` and `skip` tags) can be toggled and persists across sessions.
- **User Presets (Bottom Category):** Fully editable and customizable presets organized into custom user-defined folders (e.g., "Chill Ambient", "Techno Pulse", "Live Set"). Users can create folders, move presets between folders, rename folders, delete folders (safely unfiling presets), duplicate, rename, export, and delete presets.
- **Studio Optgroup Hierarchy:** The Studio preset dropdown is upgraded from a flat list to an organized `<optgroup>` hierarchy, delivering categorical grouping in all modern browsers without adding external UI dependencies.
- **Browser Persistence:** Folder definitions and associations are persisted in `localStorage` under `mv.userPresetFolders`, `mv.userPresets`, and `mv.systemPresetTagOverrides`.

---

## 2. Categorical Taxonomy & System Preset Groupings

### 2.1 The Two Top-Level Categories

```
Preset Library Root
├── [📁 System Presets] (Read-Only Core Engine Presets)
│   ├── [📁 Stage 9 Showcase (13–20)]  (8 presets)
│   ├── [📁 Flagship Generative (01–12)] (12 presets)
│   └── [📁 Classics & Textures]         (21 presets)
└── [📁 User Presets]   (Mutable User Creations)
    ├── [📁 User Folder A]               (n presets)
    ├── [📁 User Folder B]               (n presets)
    └── [📁 Unfiled]                     (presets with no assigned folder)
```

### 2.2 System Presets Subfolders (Immutable Factory Presets)

System presets are hardcoded factory presets shipped with the application (`src/presets/builtin/`). They are read-only and immutable in shader structure and parameters, but support user tag customization.

#### Subfolder A: "Stage 9 Showcase (13–20)"
Showcases the unified composable `shape` layer architecture (Sector 485):
- `13-solar-crown-eclipse`: Solar Crown Eclipse
- `14-sacred-orbit-mandala`: Sacred Orbit Mandala
- `15-polar-spirograph-bloom`: Polar Spirograph Bloom
- `16-hexagon-inward-portal`: Hexagon Inward Portal
- `17-corridor-led-equalizer`: Corridor LED Equalizer
- `18-star-burst-stream`: Star Burst Stream
- `19-spiral-pearl-beads`: Spiral Pearl Beads
- `20-dual-rail-aurora-ark`: Dual Rail Aurora Ark

#### Subfolder B: "Flagship Generative (01–12)"
Flagship generative algorithms and physical simulations (Stages 7 & 7B):
- `01-curl-fluid-warp`: 01 · Curl Fluid Warp
- `02-kaleidoscopic-mandala`: 02 · Kaleidoscopic Mandala
- `03-solarized-contour-rings`: 03 · Solarized Contour Rings
- `04-mobius-dual-vortex`: 04 · Möbius Dual Vortex
- `05-rgb-aberration-vortex`: 05 · RGB Aberration Vortex
- `06-lissajous-vector-crt`: 06 · Lissajous Vector CRT
- `07-moire-interference-loom`: 07 · Moiré Interference Loom
- `08-spectral-ridge-terrain`: 08 · Spectral Ridge Terrain
- `09-chladni-cymatic-sand`: 09 · Chladni Cymatic Sand
- `10-phyllotaxis-spiral-bloom`: 10 · Phyllotaxis Spiral Bloom
- `11-ferrofluid-magnetic-crown`: 11 · Ferrofluid Magnetic Crown
- `12-reaction-diffusion-coral`: 12 · Reaction-Diffusion Coral

#### Subfolder C: "Classics & Textures"
Classic visualizer scenes (Stages 2–4) and band-limited texture presets (Stages 6–7):
- **Classics:**
  - `crown`: Crown (Default visualizer scene)
  - `flight`: Flight
  - `bars`: Bars
  - `starter-vortex`: Vortex
  - `starter-honeycomb`: Honeycomb
  - `starter-pentagon-pulse`: Pentagon Pulse
  - `starter-checker-warp`: Checker Warp
  - `starter-stripe-drift`: Stripe Drift
  - `starter-kaleido`: Kaleido
  - `starter-soft-smoke`: Soft Smoke
  - `starter-circle-wave`: Circle Wave
  - `starter-ember`: Ember
  - `starter-quiet-tunnel`: Quiet Tunnel
- **Textures:**
  - `tex-glass-tunnel`: Glass Tunnel
  - `tex-sub-bloom`: Sub Bloom
  - `tex-silk-rings`: Silk Rings
  - `tex-static-rain`: Static Rain
  - `tex-prism-bars`: Prism Bars
  - `tex-pulse-skin`: Pulse Skin
  - `tex-grain-crown`: Grain Crown
  - `tex-ripple-field`: Ripple Field
  - `tex-neon-weave`: Neon Weave
  - `tex-dust-wave`: Dust Wave

### 2.3 System Preset Immutability Invariants
1. `session.save(id)` throws `Error("Built-in presets are read-only. Use 'Save as' to keep a copy.")`.
2. `session.rename(id, newName)` throws `Error("Built-in presets cannot be renamed.")`.
3. `session.remove(id)` throws `Error("Built-in presets cannot be deleted.")`.
4. `session.setPresetFolder(id, folderId)` throws `Error("Cannot move built-in system presets.")`.
5. Saving a copy of a system preset via `session.saveAs(fromId, name)` creates an independent user preset in User Presets (placed into `Unfiled` or the active user folder).
6. **Persistent Tag Overrides (`mv.systemPresetTagOverrides`):** While preset geometry and parameters cannot be altered on builtins, users CAN favorite (`tags: ['favourite']`) or skip (`tags: ['skip']`) system presets for auto-cycle and shuffle. These tag customizations are persisted separately in `localStorage` and rehydrated over builtins on startup.

---

## 3. Data Contracts & Storage Schema

### 3.1 User Folder Schema

```ts
export interface UserPresetFolder {
  /** Unique stable ID, e.g. "folder-1731000000-abc123" */
  id: string;
  /** Display name shown in UI, e.g. "Chill Ambient" */
  name: string;
  /** Creation timestamp in epoch milliseconds */
  createdAt: number;
}
```

### 3.2 Storage Keys & Payloads (`src/presets/session.ts`)

| Key | Format | Description |
|---|---|---|
| `mv.userPresetFolders` | `UserPresetFolder[]` | Array of user-created folders. |
| `mv.userPresets` | `StoredUserPreset[]` | User presets with optional `folderId` association. |
| `mv.systemPresetTagOverrides` | `Record<string, string[]>` | Mapping of system preset ID to custom tags (`favourite`, `skip`). |
| `mv.preset` | `string` | ID of the active/last-shown preset. |

```ts
export interface StoredUserPreset {
  id: string;
  preset: Preset;
  folderId?: string;
}
```

### 3.3 Folder Association & Resolution Invariants
- If `storedPreset.folderId` is missing, `undefined`, or references a folder ID that no longer exists in `mv.userPresetFolders`, the preset resolves to `undefined` (`Unfiled`).
- Deleting a folder unlinks all its presets (`entry.folderId = undefined`) and persists both the updated folder list and presets. **Presets inside a deleted folder are NEVER accidentally deleted.**
- Renaming a folder updates `folder.name` in `mv.userPresetFolders`. Presets reference `folder.id`, so all folder memberships remain intact across renames with zero database-wide preset edits.

---

## 4. PresetSession API Contracts (`src/presets/session.ts`)

The `PresetSession` class owns the working copies of presets, manages persistence, and coordinates scene rebuilding. Stage 10 extends `PresetSession` with the following methods:

```ts
export class PresetSession {
  // --- Folder Management ---
  /** Returns all user-created folders sorted by creation time or name. */
  getFolders(): readonly UserPresetFolder[];

  /** Creates a new user folder with the given name. Returns the created folder. */
  createFolder(name: string): UserPresetFolder;

  /** Renames an existing user folder. Throws if folder not found. */
  renameFolder(folderId: string, newName: string): void;

  /**
   * Deletes a user folder. Unfiles all presets assigned to this folder.
   * Does NOT delete the presets themselves.
   */
  deleteFolder(folderId: string): void;

  /**
   * Moves a user preset into a folder (or unfiles it if folderId is undefined/null/'').
   * Throws if preset is a built-in system preset.
   */
  setPresetFolder(presetId: string, folderId: string | undefined): void;

  /** Returns the folderId associated with a preset, or undefined if unfiled/builtin. */
  getPresetFolder(presetId: string): string | undefined;

  // --- Tag Customization for System Presets ---
  /**
   * Sets tags for a preset. If the preset is built-in, persists the tags
   * to mv.systemPresetTagOverrides so favourites/skips survive reload.
   */
  setPresetTags(presetId: string, tags: string[]): void;

  // --- Categorized Querying ---
  /**
   * Returns all presets grouped into hierarchical categories for UI presentation.
   */
  listCategorized(): CategorizedPresets;
}

export interface CategorizedPresets {
  system: {
    showcase: SessionEntry[];
    flagship: SessionEntry[];
    classics: SessionEntry[];
  };
  user: {
    folders: Array<{
      folder: UserPresetFolder;
      entries: SessionEntry[];
    }>;
    unfiled: SessionEntry[];
  };
}
```

---

## 5. Studio UI & Hierarchy Design (`src/studio/studio.ts`)

### 5.1 Hierarchical Dropdown Structure (`<select>` + `<optgroup>`)

The single flat preset dropdown in Studio is replaced with an organized `<optgroup>` hierarchy. In standard HTML, `<optgroup>` provides non-selectable categorical headers with indented options, supported universally across all browsers:

```html
<select class="tp-lstv_s" aria-label="Preset">
  <!-- System Presets Category -->
  <optgroup label="System: Stage 9 Showcase (13–20)">
    <option value="13-solar-crown-eclipse">13 · Solar Crown Eclipse</option>
    <option value="14-sacred-orbit-mandala">14 · Sacred Orbit Mandala</option>
    ...
  </optgroup>
  <optgroup label="System: Flagship Generative (01–12)">
    <option value="01-curl-fluid-warp">01 · Curl Fluid Warp</option>
    <option value="02-kaleidoscopic-mandala">02 · Kaleidoscopic Mandala</option>
    ...
  </optgroup>
  <optgroup label="System: Classics & Textures">
    <option value="crown">Crown</option>
    <option value="flight">Flight</option>
    ...
    <option value="tex-glass-tunnel">Glass Tunnel</option>
    ...
  </optgroup>

  <!-- User Presets Category -->
  <optgroup label="User: Chill Ambient">
    <option value="user-1a2b">Midnight Flight</option>
  </optgroup>
  <optgroup label="User: Unfiled">
    <option value="user-3c4d">Quick Test</option>
  </optgroup>
</select>
```

A dedicated helper function `renderPresetSelectHierarchy(selectEl: HTMLSelectElement, session: PresetSession, currentId: string): void` populates this structure and maintains synchronization with Tweakpane's internal state.

### 5.2 Studio Preset Bar Layout & Controls

When a preset is active, the Studio preset bar presents contextual affordances based on whether the preset is a System preset or a User preset:

#### Case A: Active Preset is a System Preset
1. **Preset Selector:** Hierarchical dropdown showing current selection.
2. **Category Indicator:** Text display showing `System Preset (Read-Only) · [Subfolder Name]`.
3. **Name Field:** Disabled or read-only (system names cannot be edited).
4. **Favourite / Skip Toggles:** Fully active. Toggling updates `entry.preset.tags` and persists to `mv.systemPresetTagOverrides`.
5. **Action Buttons:**
   - `Save`: Disabled or marked `(Read-only)` — clicking shows a toast explaining system presets are immutable.
   - `Save as…` & `Duplicate`: Fully active. Copies preset into a new User Preset.
   - `Delete`: Hidden (system presets cannot be deleted).
   - `Export .json`, `Undo`, `Redo`: Fully active.

#### Case B: Active Preset is a User Preset
1. **Preset Selector:** Hierarchical dropdown showing current selection.
2. **Folder Assignment Dropdown:**
   - Label: `Folder`
   - Options: `(Unfiled)`, followed by each user folder name, followed by `+ New Folder…`.
   - Selecting an existing folder moves the preset via `session.setPresetFolder(id, folderId)`.
   - Selecting `+ New Folder…` triggers an inline name input (or standard prompt fallback), creates the folder, and assigns the preset.
3. **Folder Management Affordance:**
   - If the preset is in a user folder, an action button or context menu allows `Rename Folder` or `Delete Folder` (with confirm).
   - "Add Folder" button in the preset bar.
4. **Name Field:** Fully editable. Edits update the preset name.
5. **Action Buttons:**
   - `Save`: Saves changes to `localStorage`.
   - `Save as…` & `Duplicate`: Creates a copy in the same folder.
   - `Delete`: Two-tap safety confirmation (`DELETE_CONFIRM_MS = 3000`), then removes preset.
   - `Export .json`, `Import .json`, `Undo`, `Redo`: Fully active.

---

## 6. Auto-Cycle, Shuffle & Key Navigation Compatibility

1. **Auto-Cycle (`src/presets/autoCycle.ts`):**
   - Candidate pool generation via `eligible(candidates, opts)` uses the loaded tags.
   - Because `mv.systemPresetTagOverrides` rehydrates `favourite` and `skip` tags onto system presets at startup, auto-cycling with `favouritesOnly: true` seamlessly includes favorited system presets, and skips marked system presets.
2. **Keyboard Navigation (`src/presets/library.ts`):**
   - Key switching (`0`–`9` and `[` / `]`):
     - `session.list()` preserves a stable, deterministic ordering:
       `Showcase (13–20)` $\to$ `Flagship (01–12)` $\to$ `Classics & Textures` $\to$ `User Presets (by folder, then name)`.
     - Presets `0`, `1`, `2` retain backward-compatible access to primary classics (`Crown`, `Flight`, `Bars`) or canonical start positions.

---

## 7. Migration & Backward Compatibility

1. **Existing User Presets:**
   - When loading `mv.userPresets` from previous versions without a `folderId` property, `session.loadUserPresets()` treats them as `folderId: undefined` (`Unfiled`). No user presets are lost or corrupted.
2. **Experience Bundles (`exportExperienceBundle` / `importAsset`):**
   - The bundle asset format is backward-compatible. Stage 10 adds an optional `userFolders?: UserPresetFolder[]` array to the bundle.
   - On bundle import, any contained folders are added to `mv.userPresetFolders`, and preset `folderId` mappings are preserved.

---

## 8. Implementation Slices (Progress Breakdown)

- **Slice 10.1: Preset Taxonomy & System Subfolder Categorization Contracts** `[CORE / DATA]`
  - Define `SystemSubfolder` (`'showcase' | 'flagship' | 'classics'`) and categorize all 41 built-in presets in `src/presets/builtin/index.ts`.
  - Add `SYSTEM_TAG_OVERRIDES_KEY = 'mv.systemPresetTagOverrides'` and persist/hydrate system preset tag overrides (`favourite`, `skip`) in `src/presets/session.ts`.
  - Add `listCategorized()` to `PresetSession`.
  - Target files: `src/presets/builtin/index.ts`, `src/presets/session.ts`, `src/presets/__tests__/presetTaxonomy.test.ts` [NEW], `src/presets/session.test.ts`.
  - Verify: `npm run typecheck && npm test && npm run build`

- **Slice 10.2: User Preset Folders Data Engine & Storage Contracts** `[CORE / DATA]`
  - Implement `UserPresetFolder` interface and `USER_PRESET_FOLDERS_KEY = 'mv.userPresetFolders'`.
  - Implement folder CRUD in `PresetSession`: `getFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `setPresetFolder`, `getPresetFolder`.
  - Update `StoredUserPreset` in `USER_PRESETS_KEY` with `folderId?: string`.
  - Verify unfiling safety on folder deletion and strict built-in move prevention.
  - Target files: `src/presets/session.ts`, `src/presets/session.test.ts`.
  - Verify: `npm run typecheck && npm test && npm run build`

- **Slice 10.3: Studio Hierarchical Optgroup Preset Selector** `[UI / VISUAL]`
  - Implement `renderPresetSelectHierarchy` to populate `<select>` with `<optgroup>` groupings for Showcase, Flagship, Classics & Textures, and User Folders / Unfiled.
  - Wire hierarchy into `Studio.bind()` and handle selection changes.
  - Add unit tests verifying DOM optgroup structure and headless fallback.
  - Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts`.
  - Verify: `npm run typecheck && npm test && npm run build`

- **Slice 10.4: Studio User Folder Management UI, Preset Moving & Read-Only Invariants** `[UI / VISUAL]`
  - Add Folder assignment dropdown and "Add Folder" affordances to Studio for User Presets.
  - Enforce read-only UI states for System Presets (disabled/hidden Save and Delete, category label).
  - Connect folder creation, renaming, deletion, and preset assignment to live Studio pane.
  - Target files: `src/studio/studio.ts`, `src/studio/studio.test.ts`, `src/style.css`.
  - Verify: `npm run typecheck && npm test && npm run build`
