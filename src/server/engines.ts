import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Config } from './config.ts';
import {
  buildCompositionHtml,
  type Composer,
  type CompositionJob,
  type MediaTools,
  gsapPath,
  localGsap,
  VIDEO_FPS,
} from './render.ts';

const WORKERS = 2;
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

function hyperframesCli(): string {
  return join(dirname(require.resolve('hyperframes/package.json')), 'bin', 'hyperframes.mjs');
}

const HYPERFRAMES_ENV = { HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1' };
const MAX_FOOTAGE_SECONDS = 180;

export function mediaTools(config: Config): MediaTools {
  return {
    async normalize(source, target, signal) {
      mkdirSync(dirname(target), { recursive: true });
      const result = await run(
        config.ffmpegPath,
        [
          '-y', '-hide_banner',
          '-i', source,
          '-t', String(MAX_FOOTAGE_SECONDS),
          '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '30',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-movflags', '+faststart',
          target,
        ],
        { signal },
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new Error('Falta ffmpeg en el servidor. Instálalo o define FFMPEG_PATH.');
        throw error;
      });
      if (result.code !== 0 || !existsSync(target)) {
        throw new Error(`No pude leer el video subido: ${result.output.trim().slice(-400)}`);
      }
      const probe = await run(config.ffmpegPath, ['-hide_banner', '-i', target], { signal });
      const time = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe.output);
      if (!time) throw new Error('No pude medir la duración del video.');
      return Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
    },

    async transcribe(path, signal) {
      const work = join(config.dataDir, 'cache', 'transcribe', randomUUID());
      mkdirSync(work, { recursive: true });
      try {
        const result = await run(
          process.execPath,
          [
            hyperframesCli(), 'transcribe', path,
            '--dir', work,
            '--engine', 'whisper',
            '--model', config.transcribeModel,
            '--language', config.transcribeLanguage,
            '--json',
          ],
          { signal, env: { ...process.env, ...HYPERFRAMES_ENV } },
        );
        const file = join(work, 'transcript.json');
        if (result.code !== 0 || !existsSync(file)) {
          throw new Error(`No pude transcribir el video: ${result.output.trim().slice(-500) || result.code}`);
        }
        const words = JSON.parse(readFileSync(file, 'utf8')) as { text: string; start: number; end: number }[];
        return words
          .map((word) => ({ text: String(word.text).trim(), start: Number(word.start), end: Number(word.end) }))
          .filter((word) => word.text);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    },
  };
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
      const data = { ...job.data };
      if (job.footage && data.footage) {
        symlinkSync(job.footage, join(project, 'footage.mp4'));
        data.footage = { ...data.footage, src: 'footage.mp4' };
      }
      writeFileSync(
        join(project, 'index.html'),
        localGsap(buildCompositionHtml(job.template, tokens(), data), '<script src="gsap.min.js"></script>'),
      );
      const result = await run(
        process.execPath,
        [hyperframesCli(), 'render', project, '-o', job.path, '--fps', String(VIDEO_FPS), '--workers', String(WORKERS), '--quiet'],
        {
          signal: job.signal,
          env: { ...process.env, ...HYPERFRAMES_ENV, ...(shell ? { HYPERFRAMES_BROWSER_PATH: shell } : {}) },
        },
      );
      if (result.code !== 0 || !existsSync(job.path)) {
        throw new Error(`HyperFrames no pudo renderizar: ${result.output.trim().slice(-600) || result.code}`);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  return async (job) => {
    mkdirSync(dirname(job.path), { recursive: true });
    await hyperframes(job);
    await ensureAudio(config.ffmpegPath, job.path, job.signal);
  };
}
