// Studio preset picker: the dropdown grouped into system folders, user folders and loose presets (Slice 10.3).
import { SYSTEM_SUBFOLDER_LABELS, type SystemSubfolder } from '../presets/builtin';
import { type PresetSession, type SessionEntry } from '../presets/session';

/** Preset picker group names: the system folder names with a "System:" prefix. */
export const SYSTEM_OPTGROUP_LABELS: Readonly<Record<SystemSubfolder, string>> = {
  showcase: `System: ${SYSTEM_SUBFOLDER_LABELS.showcase}`,
  flagship: `System: ${SYSTEM_SUBFOLDER_LABELS.flagship}`,
  classics: `System: ${SYSTEM_SUBFOLDER_LABELS.classics}`,
};

/** Populate selectEl with an optgroup hierarchy matching session categorization (Slice 10.3). */
export function renderPresetSelectHierarchy(
  selectEl: HTMLSelectElement,
  session: PresetSession,
  currentId: string,
): void {
  if (!selectEl) return;

  if (typeof selectEl.replaceChildren === 'function') {
    selectEl.replaceChildren();
  } else {
    while (selectEl.firstChild) {
      selectEl.removeChild(selectEl.firstChild);
    }
  }

  const doc = selectEl.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  const categorized = typeof session.listCategorized === 'function' ? session.listCategorized() : null;
  if (!categorized) return;

  const addGroup = (label: string, entries: SessionEntry[]) => {
    if (!entries || entries.length === 0) return;
    const optgroup = doc.createElement('optgroup');
    optgroup.setAttribute('label', label);
    if ('label' in optgroup) {
      (optgroup as any).label = label;
    }
    for (const entry of entries) {
      const opt = doc.createElement('option');
      opt.setAttribute('value', entry.id);
      if ('value' in opt) {
        (opt as any).value = entry.id;
      }
      opt.textContent = entry.preset.name;
      if (entry.id === currentId) {
        opt.setAttribute('selected', 'selected');
        if ('selected' in opt) {
          (opt as any).selected = true;
        }
      }
      optgroup.appendChild(opt);
    }
    selectEl.appendChild(optgroup);
  };

  // System groups
  if (categorized.system.showcase.length > 0) {
    addGroup(SYSTEM_OPTGROUP_LABELS.showcase, categorized.system.showcase);
  }
  if (categorized.system.flagship.length > 0) {
    addGroup(SYSTEM_OPTGROUP_LABELS.flagship, categorized.system.flagship);
  }
  if (categorized.system.classics.length > 0) {
    addGroup(SYSTEM_OPTGROUP_LABELS.classics, categorized.system.classics);
  }

  // User groups
  for (const group of categorized.user.folders) {
    if (group.entries.length > 0) {
      addGroup(`User: ${group.folder.name}`, group.entries);
    }
  }
  if (categorized.user.unfiled.length > 0) {
    addGroup('User: Unfiled', categorized.user.unfiled);
  }

  selectEl.value = currentId;
  if (typeof selectEl.setAttribute === 'function') {
    selectEl.setAttribute('value', currentId);
  }
}
