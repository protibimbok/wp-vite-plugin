import { describe, expect, it } from 'vitest';
import { collectEntryDependencies, type ChunkGraphNode } from '../src/build/deps.js';
import { createClassifier } from '../src/externals/classify.js';
import { createDeps, type ExternalDeps } from '../src/externals/rewrite.js';

const classify = createClassifier({}, import.meta.dirname);

function record(globals: string[], modules: Array<[string, boolean]> = []): ExternalDeps {
  const deps = createDeps();
  for (const request of globals) {
    const c = classify(request, 'iife');
    if (c.kind === 'global') deps.globals.set(request, c);
  }
  for (const [request, dynamic] of modules) {
    const c = classify(request, 'es');
    if (c.kind === 'module') deps.modules.set(c.id, { classification: c, dynamic });
  }
  return deps;
}

function chunk(fileName: string, moduleIds: string[], imports: string[] = [], dynamicImports: string[] = []): ChunkGraphNode {
  return { fileName, moduleIds, imports, dynamicImports };
}

function graph(...nodes: ChunkGraphNode[]) {
  return new Map(nodes.map((n) => [n.fileName, n]));
}

describe('collectEntryDependencies', () => {
  it('unions globals over the entry and its static chunk closure, sorted and de-duplicated', () => {
    const chunks = graph(
      chunk('index.js', ['/a.js'], ['chunks/s1.js']),
      chunk('chunks/s1.js', ['/b.js'], ['chunks/s2.js']),
      chunk('chunks/s2.js', ['/c.js'], ['chunks/s1.js']),
    );
    const records = new Map([
      ['/a.js', record(['@wordpress/i18n', 'react/jsx-runtime'])],
      ['/b.js', record(['@wordpress/blocks', '@wordpress/i18n'])],
      ['/c.js', record(['@wordpress/element'])],
    ]);
    expect(collectEntryDependencies(chunks.get('index.js')!, chunks, records)).toEqual({
      scripts: ['react-jsx-runtime', 'wp-blocks', 'wp-element', 'wp-i18n'],
      modules: [],
      dynamicModules: [],
      imports: ['chunks/s1.js', 'chunks/s2.js'],
      dynamicImports: [],
    });
  });

  it('marks modules reached through dynamic chunks or dynamic imports as dynamic, static wins', () => {
    const chunks = graph(
      chunk('view.js', ['/v.js'], [], ['chunks/lazy.js']),
      chunk('chunks/lazy.js', ['/l.js'], ['chunks/helper.js']),
      chunk('chunks/helper.js', ['/h.js']),
    );
    const records = new Map([
      ['/v.js', record(['@wordpress/i18n'], [['@wordpress/interactivity', false], ['@wordpress/a11y', true]])],
      ['/l.js', record(['@wordpress/blocks'], [['@wordpress/interactivity-router', false], ['@wordpress/a11y', false]])],
      ['/h.js', record([], [['@wordpress/interactivity', true]])],
    ]);
    expect(collectEntryDependencies(chunks.get('view.js')!, chunks, records)).toEqual({
      scripts: ['wp-blocks', 'wp-i18n'],
      modules: ['@wordpress/interactivity'],
      dynamicModules: ['@wordpress/a11y', '@wordpress/interactivity-router'],
      imports: [],
      dynamicImports: ['chunks/lazy.js', 'chunks/helper.js'],
    });
  });

  it('keeps @wordpress/interactivity static even when only imported dynamically', () => {
    const chunks = graph(chunk('view.js', ['/v.js']));
    const records = new Map([['/v.js', record([], [['@wordpress/interactivity', true]])]]);
    expect(collectEntryDependencies(chunks.get('view.js')!, chunks, records).modules).toEqual(['@wordpress/interactivity']);
  });

  it('ignores external ids in chunk imports and modules without records', () => {
    const chunks = graph(chunk('index.js', ['/a.js', '\0virtual'], ['@wordpress/a11y'], ['@wordpress/interactivity-router']));
    expect(collectEntryDependencies(chunks.get('index.js')!, chunks, new Map())).toEqual({
      scripts: [],
      modules: [],
      dynamicModules: [],
      imports: [],
      dynamicImports: [],
    });
  });
});
