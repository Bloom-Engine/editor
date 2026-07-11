// Path and string helpers for the editor IO layer.

export function basenameNoExt(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const start = slash < 0 ? 0 : slash + 1;
  const end = dot <= start ? path.length : dot;
  return path.substring(start, end);
}

export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.substring(slash + 1);
}

export function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.substring(dot);
}

// Derive a category from a model filename. Convention: underscore-separated
// prefix, e.g. "tree_oak.glb" → "tree", "flower_redA.glb" → "flower".
// Falls back to "other" when no underscore is found.
export function categoryFromName(relPath: string): string {
  const name = basenameNoExt(relPath);
  const underscore = name.indexOf('_');
  if (underscore > 0) return name.substring(0, underscore);
  return 'other';
}

export function joinPath(a: string, b: string): string {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  if (a.charAt(a.length - 1) === '/') return a + b;
  return a + '/' + b;
}
