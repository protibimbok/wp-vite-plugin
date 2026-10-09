import type { ExternalDeps } from '../externals/rewrite.js';

export interface ChunkGraphNode {
  fileName: string;
  moduleIds: readonly string[];
  imports: readonly string[];
  dynamicImports: readonly string[];
}

export interface EntryDependencies {
  scripts: string[];
  modules: string[];
  dynamicModules: string[];
  imports: string[];
  dynamicImports: string[];
}

export function collectEntryDependencies(
  entry: ChunkGraphNode,
  chunks: ReadonlyMap<string, ChunkGraphNode>,
  records: ReadonlyMap<string, ExternalDeps>,
): EntryDependencies {
  const staticChunks = closure([entry], chunks, (c) => c.imports);
  const dynamicChunks = closure(
    [...staticChunks].flatMap((c) => c.dynamicImports.map((f) => chunks.get(f)).filter((c): c is ChunkGraphNode => !!c)),
    chunks,
    (c) => [...c.imports, ...c.dynamicImports],
  );
  for (const chunk of staticChunks) dynamicChunks.delete(chunk);

  const scripts = new Set<string>();
  const staticModules = new Set<string>();
  const dynamicModules = new Set<string>();

  const visit = (chunk: ChunkGraphNode, viaDynamicChunk: boolean) => {
    for (const id of chunk.moduleIds) {
      const record = records.get(id);
      if (!record) continue;
      for (const global of record.globals.values()) scripts.add(global.handle);
      for (const { classification, dynamic } of record.modules.values()) {
        const isStatic = classification.staticOnly || (!dynamic && !viaDynamicChunk);
        (isStatic ? staticModules : dynamicModules).add(classification.id);
      }
    }
  };
  for (const chunk of staticChunks) visit(chunk, false);
  for (const chunk of dynamicChunks) visit(chunk, true);
  for (const id of staticModules) dynamicModules.delete(id);

  return {
    scripts: [...scripts].sort(),
    modules: [...staticModules].sort(),
    dynamicModules: [...dynamicModules].sort(),
    imports: [...staticChunks].filter((c) => c !== entry).map((c) => c.fileName),
    dynamicImports: [...dynamicChunks].map((c) => c.fileName),
  };
}

function closure(
  start: ChunkGraphNode[],
  chunks: ReadonlyMap<string, ChunkGraphNode>,
  edges: (chunk: ChunkGraphNode) => readonly string[],
): Set<ChunkGraphNode> {
  const seen = new Set<ChunkGraphNode>();
  const queue = [...start];
  while (queue.length) {
    const chunk = queue.shift()!;
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    for (const fileName of edges(chunk)) {
      const next = chunks.get(fileName);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}
