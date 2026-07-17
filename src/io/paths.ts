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
  // '.' is not a directory component — it is "here", and prefixing it produces a
  // path that is EQUIVALENT to `b` but not EQUAL to it. That distinction cost the
  // editor its entire model rendering:
  //
  //   the project file lives in the CWD, so rootDir came out as '.'
  //   -> the asset catalog was keyed './assets/models/prop_tree.glb'
  //   -> world entities reference  'assets/models/prop_tree.glb'
  //   -> every lookup missed, and EVERY entity with a model rendered as a grey
  //      placeholder cube. The whole arena — 88 trees, the building, every prop.
  //
  // The models loaded fine. Nothing errored. The editor just quietly showed you a
  // level made of boxes, which is indistinguishable from "this level is made of
  // boxes" and is why it survived so long.
  if (a.length === 0 || a === '.' || a === './') return b;
  if (b.length === 0) return a;
  if (a.charAt(a.length - 1) === '/') return a + b;
  return a + '/' + b;
}

// The inverse of joinPath(rootDir, ...): strip the project root prefix so the
// result is PROJECT-RELATIVE — the exact string world files store in modelRef
// and the exact string the catalog must be keyed by.
//
// This is the same identity rule joinPath's comment describes, from the other
// side: with `--project ../shooter/editor.project.json` the resolved load path
// is '../shooter/assets/models/x.glb', but the world says
// 'assets/models/x.glb'. Keying the catalog by the LOAD path made every lookup
// miss and rendered the whole arena as placeholder boxes again — the disease
// joinPath was cured of, reintroduced one level up.
export function projectRelative(rootDir: string, path: string): string {
  if (rootDir.length === 0 || rootDir === '.' || rootDir === './') return path;
  const prefix = rootDir.charAt(rootDir.length - 1) === '/' ? rootDir : rootDir + '/';
  if (path.length > prefix.length && path.substring(0, prefix.length) === prefix) {
    return path.substring(prefix.length);
  }
  return path;
}
