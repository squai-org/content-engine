import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Format } from './domain.ts';

export const KINDS = ['bases', 'templates', 'skills', 'agents'] as const;
export type Kind = (typeof KINDS)[number];

type KindSpec = { dir: string; extensions: string[]; nested?: string };

const SPECS: Record<Kind, KindSpec> = {
  bases: { dir: 'bases', extensions: ['.md'] },
  templates: { dir: 'templates', extensions: ['.html', '.css', '.tsx'] },
  skills: { dir: '.claude/skills', extensions: [], nested: 'SKILL.md' },
  agents: { dir: '.claude/agents', extensions: ['.md'] },
};

const NAME = /^[a-z0-9][a-z0-9-]*(\.[a-z]+)?$/;

export const ENGINES = ['nativo', 'hyperframes', 'remotion'] as const;
export type Engine = (typeof ENGINES)[number];
export type TemplateInfo = {
  name: string;
  width: number;
  height: number;
  formats: string[];
  engine: Engine;
};

export function isKind(value: string): value is Kind {
  return KINDS.includes(value as Kind);
}

const SEED_HISTORY = '.seed-history.json';
const SEED_MANIFEST = '.seed.json';

function fingerprint(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path, base) : [relative(base, path)];
  });
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function templateMeta(html: string): Omit<TemplateInfo, 'name'> | null {
  const size = /<meta name="size" content="(\d+)x(\d+)"/.exec(html);
  const formats = /<meta name="formats" content="([^"]+)"/.exec(html);
  if (!size || !formats) return null;
  const engine = /<meta name="engine" content="([^"]+)"/.exec(html)?.[1] as Engine | undefined;
  return {
    width: Number(size[1]),
    height: Number(size[2]),
    formats: formats[1].split(',').map((format) => format.trim()),
    engine: engine && ENGINES.includes(engine) ? engine : 'nativo',
  };
}

export function syncSeed(root: string, seedDir: string): string[] {
  if (!existsSync(seedDir)) return [];
  mkdirSync(root, { recursive: true });
  const history = readJson<Record<string, string[]>>(join(seedDir, SEED_HISTORY), {});
  const manifestPath = join(root, SEED_MANIFEST);
  const manifest = readJson<Record<string, string>>(manifestPath, {});
  const fresh = !existsSync(manifestPath);
  const written: string[] = [];
  for (const file of walk(seedDir)) {
    if (file === SEED_HISTORY) continue;
    const source = join(seedDir, file);
    const target = join(root, file);
    const seedHash = fingerprint(source);
    const copy = () => {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(source));
      manifest[file] = seedHash;
      written.push(file);
    };
    if (!existsSync(target)) {
      if (manifest[file] !== seedHash) copy();
      continue;
    }
    const current = fingerprint(target);
    if (current === seedHash) manifest[file] = seedHash;
    else if (manifest[file] === current || (fresh && history[file]?.includes(current))) copy();
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
  return written;
}

export function createWorkspace(root: string, seedDir: string) {
  syncSeed(root, seedDir);

  function pathFor(kind: Kind, name: string): string {
    const spec = SPECS[kind];
    if (!NAME.test(name)) throw new Error('Nombre inválido.');
    if (spec.nested) {
      if (name.includes('.')) throw new Error('Nombre inválido.');
      return join(root, spec.dir, name, spec.nested);
    }
    if (!spec.extensions.some((extension) => name.endsWith(extension))) {
      throw new Error(`Extensión permitida: ${spec.extensions.join(', ')}.`);
    }
    return join(root, spec.dir, name);
  }

  function list(kind: Kind): string[] {
    const spec = SPECS[kind];
    const dir = join(root, spec.dir);
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir, { withFileTypes: true });
    const names = spec.nested
      ? entries
          .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
          .map((entry) => entry.name)
      : entries
          .filter((entry) => entry.isFile() && spec.extensions.some((e) => entry.name.endsWith(e)))
          .map((entry) => entry.name);
    return names.sort();
  }

  function read(kind: Kind, name: string): string | null {
    const path = pathFor(kind, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  function templateInfo(name: string): TemplateInfo | null {
    const html = read('templates', name);
    if (!html || name.endsWith('.css')) return null;
    const meta = templateMeta(html);
    return meta ? { name, ...meta } : null;
  }

  function templatesFor(format: Format): TemplateInfo[] {
    return list('templates')
      .map(templateInfo)
      .filter((info): info is TemplateInfo => info?.formats.includes(format) ?? false);
  }

  return {
    root,
    list,
    read,
    templatesFor,

    write(kind: Kind, name: string, content: string): void {
      const path = pathFor(kind, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },

    remove(kind: Kind, name: string): void {
      const path = pathFor(kind, name);
      rmSync(SPECS[kind].nested ? dirname(path) : path, { recursive: true, force: true });
    },

    pickTemplate(preferred: string, format: Format): TemplateInfo {
      const options = templatesFor(format);
      const wanted = preferred.trim().split(/\s/)[0];
      const match = options.find((option) => option.name === wanted) ?? options[0];
      if (!match) throw new Error(`No hay template para el formato ${format}.`);
      return match;
    },

    tokens(): string {
      return read('templates', 'tokens.css') ?? '';
    },

    appendLearning(text: string): void {
      const path = join(root, 'bases', 'aprendizajes.md');
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `\n- ${text.trim().replace(/\s+/g, ' ')}\n`);
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
