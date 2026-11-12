import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Config } from './config.ts';
import {
  buildCompositionHtml,
  type Composer,
  type CompositionJob,
  gsapPath,
  localGsap,
  VIDEO_FPS,
} from './render.ts';

const WORKERS = 2;
const KEEP_BUNDLES = 3;
const SHELL_NAMES = ['chrome-headless-shell', 'headless_shell'];
const require = createRequire(import.meta.url);

type Outcome = { code: number | null; output: string };

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}) {
  return new Promise<Outcome>((done, fail) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const stop = () => {
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {}
    };
    options.signal?.addEventListener('abort', stop, { once: true });
    child.on('error', fail);
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', stop);
      if (options.signal?.aborted) fail(new Error('Ejecución cancelada.'));
      else done({ code, output });
    });
  });
}

export function findHeadlessShell(roots: string[]): string | undefined {
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const builds = readdirSync(root)
      .filter((name) => name.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const build of builds) {
      for (const folder of readdirSync(join(root, build))) {
        for (const name of SHELL_NAMES) {
          const path = join(root, build, folder, name);
          if (existsSync(path)) return path;
        }
      }
    }
  }
  return undefined;
}

async function ensureAudio(ffmpeg: string, path: string, signal?: AbortSignal): Promise<void> {
  const probe = await run(ffmpeg, ['-hide_banner', '-i', path], { signal });
  if (/Stream #\d+:\d+.*Audio:/.test(probe.output)) return;
  const silent = `${path}.audio.mp4`;
  const mixed = await run(
    ffmpeg,
    [
      '-y', '-loglevel', 'error',
      '-i', path,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      silent,
    ],
    { signal },
  );
  if (mixed.code !== 0) throw new Error(`ffmpeg falló: ${mixed.output.trim()}`);
  renameSync(silent, path);
}

export function videoComposer(config: Config, tokens: () => string): Composer {
  const cache = join(config.dataDir, 'cache');
  const shell =
    config.headlessShellPath ??
    findHeadlessShell([
      process.env.PLAYWRIGHT_BROWSERS_PATH ?? '',
      join(homedir(), '.cache', 'ms-playwright'),
    ].filter(Boolean));

  async function hyperframes(job: CompositionJob): Promise<void> {
    const project = join(cache, 'hyperframes', randomUUID());
    mkdirSync(project, { recursive: true });
    try {
      copyFileSync(gsapPath(), join(project, 'gsap.min.js'));
      writeFileSync(
        join(project, 'index.html'),
        localGsap(buildCompositionHtml(job.template, tokens(), job.data), '<script src="gsap.min.js"></script>'),
      );
      const cli = join(dirname(require.resolve('hyperframes/package.json')), 'bin', 'hyperframes.mjs');
      const result = await run(
        process.execPath,
        [cli, 'render', project, '-o', job.path, '--fps', String(VIDEO_FPS), '--workers', String(WORKERS), '--quiet'],
        {
          signal: job.signal,
          env: {
            ...process.env,
            HYPERFRAMES_NO_TELEMETRY: '1',
            HYPERFRAMES_SKIP_SKILLS: '1',
            ...(shell ? { HYPERFRAMES_BROWSER_PATH: shell } : {}),
          },
        },
      );
      if (result.code !== 0 || !existsSync(job.path)) {
        throw new Error(`HyperFrames no pudo renderizar: ${result.output.trim().slice(-600) || result.code}`);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  async function remotionBundle(job: CompositionJob): Promise<string> {
    const root = join(cache, 'remotion');
    const hash = createHash('sha256')
      .update(`${job.width}x${job.height}\n${job.template}`)
      .digest('hex')
      .slice(0, 16);
    const project = join(root, hash);
    const bundled = join(project, 'bundle');
    if (existsSync(join(bundled, 'index.html'))) return bundled;
    rmSync(project, { recursive: true, force: true });
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(join(project, 'src', 'Template.tsx'), job.template);
    writeFileSync(
      join(project, 'src', 'index.tsx'),
      [
        "import { Composition, registerRoot } from 'remotion';",
        "import Template from './Template';",
        'const Root = () => (',
        '  <Composition',
        '    id="main"',
        '    component={Template as never}',
        `    width={${job.width}}`,
        `    height={${job.height}}`,
        `    fps={${VIDEO_FPS}}`,
        `    durationInFrames={${VIDEO_FPS}}`,
        "    defaultProps={{ service: '', duration: 1, scenes: [] }}",
        '    calculateMetadata={({ props }) => ({',
        `      durationInFrames: Math.max(1, Math.round((props as { duration: number }).duration * ${VIDEO_FPS})),`,
        '    })}',
        '  />',
        ');',
        'registerRoot(Root);',
        '',
      ].join('\n'),
    );
    const modules = resolve('node_modules');
    const { bundle } = await import('@remotion/bundler');
    try {
      await bundle({
        entryPoint: join(project, 'src', 'index.tsx'),
        outDir: bundled,
        enableCaching: false,
        webpackOverride: (webpack) => ({
          ...webpack,
          resolve: { ...webpack.resolve, modules: [modules, 'node_modules'] },
          resolveLoader: { ...webpack.resolveLoader, modules: [modules, 'node_modules'] },
        }),
      });
    } catch (error) {
      rmSync(project, { recursive: true, force: true });
      throw new Error(`El template de Remotion no compila: ${(error as Error).message.slice(0, 800)}`);
    }
    const stale = readdirSync(root)
      .map((name) => ({ name, at: statSync(join(root, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(KEEP_BUNDLES);
    for (const entry of stale) rmSync(join(root, entry.name), { recursive: true, force: true });
    return bundled;
  }

  async function remotion(job: CompositionJob): Promise<void> {
    const serveUrl = await remotionBundle(job);
    job.signal?.throwIfAborted();
    const { makeCancelSignal, renderMedia, selectComposition } = await import('@remotion/renderer');
    const { cancel, cancelSignal } = makeCancelSignal();
    job.signal?.addEventListener('abort', cancel, { once: true });
    const inputProps = job.data as unknown as Record<string, unknown>;
    const shared = { serveUrl, inputProps, browserExecutable: shell ?? null, logLevel: 'error' as const };
    try {
      const composition = await selectComposition({ ...shared, id: 'main' });
      await renderMedia({
        ...shared,
        composition,
        codec: 'h264',
        outputLocation: job.path,
        concurrency: WORKERS,
        enforceAudioTrack: true,
        cancelSignal,
      });
    } catch (error) {
      if (job.signal?.aborted) throw new Error('Ejecución cancelada.');
      throw new Error(`Remotion no pudo renderizar: ${(error as Error).message.slice(0, 800)}`);
    } finally {
      job.signal?.removeEventListener('abort', cancel);
    }
  }

  return async (job) => {
    mkdirSync(dirname(job.path), { recursive: true });
    if (job.engine === 'remotion') await remotion(job);
    else await hyperframes(job);
    await ensureAudio(config.ffmpegPath, job.path, job.signal);
  };
}
