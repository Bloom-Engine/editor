// Recent projects list — persisted at ~/.bloom-editor/recent.json.
// Tracks the last 10 opened projects so the editor can show a quick-open list.

import { readFile, writeFile, fileExists } from 'bloom';
import { mkdirSync, existsSync } from 'fs';

const RECENT_DIR = '.bloom-editor';
const RECENT_FILE = '.bloom-editor/recent.json';

// Use home directory. On macOS this is /Users/<name>.
// Perry doesn't expose process.env, so we derive from the CWD heuristic
// or a known path. For robustness, try a few common locations.
function getRecentPath(): string {
  // Try relative to home via .. traversal from typical project dirs.
  // Fallback: just use .bloom-editor in the CWD.
  const candidates = [
    RECENT_FILE,
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (fileExists(candidates[i])) return candidates[i];
  }
  return RECENT_FILE;
}

export interface RecentEntry {
  name: string;
  path: string;       // Absolute path to editor.project.json.
  lastOpened: string;  // ISO date string.
}

export function loadRecentProjects(): RecentEntry[] {
  const path = getRecentPath();
  if (!fileExists(path)) return [];
  const text = readFile(path);
  if (!text || text.length === 0) return [];
  try {
    const data = JSON.parse(text) as { recent?: RecentEntry[] };
    return data.recent || [];
  } catch (e) {
    return [];
  }
}

export function addRecentProject(name: string, projectPath: string): void {
  let recent = loadRecentProjects();

  // Remove existing entry with the same path.
  recent = recent.filter((e: RecentEntry) => e.path !== projectPath);

  // Add at the front.
  recent.unshift({
    name: name,
    path: projectPath,
    lastOpened: new Date().toISOString(),
  });

  // Keep only the last 10.
  if (recent.length > 10) recent.length = 10;

  // Ensure directory exists.
  if (!existsSync(RECENT_DIR)) {
    try { mkdirSync(RECENT_DIR); } catch (e) { /* ignore */ }
  }

  writeFile(getRecentPath(), JSON.stringify({ recent: recent }, null, 2));
}
