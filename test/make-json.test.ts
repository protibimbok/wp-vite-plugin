import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { po } from 'gettext-parser';
import { afterEach, describe, expect, it } from 'vitest';
import { makeJson } from '../src/cli/make-json.js';
import { fixture, listFiles } from './helpers.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

const md5 = (text: string) => createHash('md5').update(text).digest('hex');
const ADMIN = md5('build/admin/index.js');
const FRONTEND = md5('build/frontend/index.js');

async function copyLanguages(): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wp-vite-json-'));
  await fs.cp(fixture('make-json'), tempDir, { recursive: true });
  return path.join(tempDir, 'languages');
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

describe('wp-vite make-json', () => {
  it('writes one JED file per referenced script, named by the md5 of its path', async () => {
    const languages = await copyLanguages();
    const result = await makeJson({ source: path.join(languages, 'my-plugin-de_DE.po') });
    expect(result.purged).toEqual([]);
    // Without a map every referenced script path gets a file, shipped or not, as wp-cli does.
    expect(result.files).toEqual([ADMIN, FRONTEND, md5('src/shared/badge.tsx')].map((hash) => path.join(languages, `my-plugin-de_DE-${hash}.json`)));

    const admin = await readJson(result.files[0]!);
    expect(admin).toEqual({
      'translation-revision-date': '2026-01-02 03:04+0000',
      generator: expect.stringMatching(/^wp-vite\/\d/),
      source: 'build/admin/index.js',
      domain: 'messages',
      locale_data: {
        messages: {
          '': { domain: 'messages', lang: 'de_DE', 'plural-forms': 'nplurals=2; plural=(n != 1);' },
          Hello: ['Hallo'],
          'verb\u0004Post': ['Veröffentlichen'],
        },
      },
    });
    expect(await fs.readFile(result.files[0]!, 'utf8')).not.toContain('\n  ');

    const frontend = await readJson(result.files[1]!);
    expect(frontend.source).toBe('build/frontend/index.js');
    expect(frontend.locale_data.messages).toEqual({
      '': expect.any(Object),
      'verb\u0004Post': ['Veröffentlichen'],
      '%d item': ['%d Element', '%d Elemente'],
    });
    // The .po is untouched without --purge.
    expect(await fs.readFile(path.join(languages, 'my-plugin-de_DE.po'), 'utf8')).toBe(await fs.readFile(fixture('make-json/languages/my-plugin-de_DE.po'), 'utf8'));
  });

  it('scans a directory, honours --domain, --pretty-print, a destination and a source map', async () => {
    const languages = await copyLanguages();
    const destination = path.join(tempDir!, 'out');
    const result = await makeJson({ source: languages, destination, domain: 'other', prettyPrint: true, useMap: path.join(tempDir!, 'map.json') });
    expect(await listFiles(destination)).toEqual([ADMIN, md5('build/chunks/badge-abc.js'), FRONTEND].map((hash) => `other-de_DE-${hash}.json`).sort());
    expect(result.files).toHaveLength(3);
    const admin = await readJson(path.join(destination, `other-de_DE-${ADMIN}.json`));
    expect(admin.locale_data.messages.Badge).toEqual(['Abzeichen']);
    expect(await fs.readFile(path.join(destination, `other-de_DE-${ADMIN}.json`), 'utf8')).toContain('\n  "source": "build/admin/index.js",\n');
    const chunk = await readJson(path.join(destination, `other-de_DE-${md5('build/chunks/badge-abc.js')}.json`));
    expect(Object.keys(chunk.locale_data.messages)).toEqual(['', 'Badge']);
  });

  it('--purge removes the strings only scripts reference and keeps the rest', async () => {
    const languages = await copyLanguages();
    const poFile = path.join(languages, 'my-plugin-de_DE.po');
    const result = await makeJson({ source: languages, purge: true });
    expect(result.purged).toEqual([poFile]);
    const purged = po.parse(await fs.readFile(poFile));
    expect(Object.keys(purged.translations['']!)).toEqual(['', 'Hello', 'PHP only']);
    expect(purged.translations['verb']).toBeUndefined();
    expect(purged.headers['Plural-Forms']).toBe('nplurals=2; plural=(n != 1);');
    // Nothing left to purge the second time round.
    expect((await makeJson({ source: languages, purge: true })).purged).toEqual([]);
  });

  it('reports a missing source, an empty directory and a malformed map', async () => {
    const languages = await copyLanguages();
    await expect(makeJson({ source: path.join(tempDir!, 'nope.po') })).rejects.toThrow(/does not exist/);
    await expect(makeJson({ source: tempDir! })).rejects.toThrow(/No \.po files found/);
    await fs.writeFile(path.join(tempDir!, 'bad.json'), '[1]');
    await expect(makeJson({ source: languages, useMap: path.join(tempDir!, 'bad.json') })).rejects.toThrow(/a map is a JSON object/);
  });
});
