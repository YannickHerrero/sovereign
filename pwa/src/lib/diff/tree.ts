/** Folder tree built from changed file paths, folders first, single-child folders merged. */

export interface TreeNode {
  name: string;
  /** Full path for files; folder prefix for directories. */
  path: string;
  children: TreeNode[];
  file: boolean;
}

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [], file: false };
  for (const path of [...paths].sort()) {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const childPath = parts.slice(0, index + 1).join('/');
      let child = node.children.find((c) => c.name === part && c.file === isFile);
      if (!child) {
        child = { name: part, path: childPath, children: [], file: isFile };
        node.children.push(child);
      }
      node = child;
    });
  }
  return collapse(root).children;
}

/** Merges chains of single-folder directories into "a/b/c" like GitHub does. */
function collapse(node: TreeNode): TreeNode {
  node.children = node.children.map(collapse);
  node.children.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
  if (!node.file && node.name && node.children.length === 1 && !node.children[0].file) {
    const only = node.children[0];
    return { ...only, name: `${node.name}/${only.name}` };
  }
  return node;
}

/** Files whose path or name contains the filter, case-insensitive. */
export function filterPaths(paths: string[], filter: string): string[] {
  const q = filter.trim().toLowerCase();
  return q ? paths.filter((p) => p.toLowerCase().includes(q)) : paths;
}
