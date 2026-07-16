// Recent-projects panel (PLAN §H). Toggled from the toolbar; lists the
// entries recent.ts has been writing since day one — this is the read UI
// that never existed. Clicking an entry switches the whole editor to that
// project (catalog, default world, window title).

import { UiContext } from '../ui-context';
import { beginPanel, endPanel, labelSmall, listRow } from '../widgets';
import { Theme } from '../theme';
import { EditorState } from '../../state/editor-state';
import { loadRecentProjects, RecentEntry } from '../../io/recent';
import { openProject } from '../../io/open-project';

let panelOpen = false;
let entries: RecentEntry[] = [];

export function toggleRecentPanel(): void {
  panelOpen = !panelOpen;
  if (panelOpen) {
    // Re-read on open, not per frame — the file only changes when a project
    // is opened, and that closes the panel anyway.
    entries = loadRecentProjects();
  }
}

export function drawRecentPanel(ui: UiContext, state: EditorState): void {
  if (!panelOpen) return;

  const pw = 340;
  const px = Theme.outlinerWidth + 10;
  const py = Theme.toolbarHeight + 10;
  const rows = entries.length > 0 ? entries.length : 1;
  const ph = 40 + rows * (Theme.rowHeight + Theme.fontSizeSmall + Theme.spacing * 2);

  beginPanel(ui, 'recent_panel', px, py, pw, ph, 'Recent projects');

  if (entries.length === 0) {
    labelSmall(ui, 'None yet — recent projects appear here.');
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (listRow(ui, 'recent_' + i, e.name, false, 0)) {
      panelOpen = false;
      openProject(state, e.path);
      return; // State just changed wholesale; stop drawing this panel.
    }
    labelSmall(ui, '  ' + e.path);
  }

  endPanel(ui);
}
