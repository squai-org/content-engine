import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import type { Slide } from './domain.ts';

export type RenderJob = { html: string; width: number; height: number; path: string };
export type Renderer = (jobs: RenderJob[]) => Promise<void>;

export type VideoScene = { html: string; seconds: number };
export type VideoJob = {
  scenes: VideoScene[];
  width: number;
  height: number;
  path: string;
  signal?: AbortSignal;
};
export type VideoRenderer = (job: VideoJob) => Promise<void>;

export type CompositionScene = Required<Slide> & { start: number; seconds: number };
export type CompositionData = { service: string; duration: number; scenes: CompositionScene[] };
export type CompositionJob = {
  engine: 'hyperframes' | 'remotion';
  template: string;
  data: CompositionData;
  width: number;
  height: number;
  path: string;
  signal?: AbortSignal;
};
export type Composer = (job: CompositionJob) => Promise<void>;

export const VIDEO_FPS = 30;
const FONT_WAIT_MS = 8000;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]).replace(/\n/g, '<br>');
}

function rich(text: string): string {
  return escapeHtml(text).replace(/\[\[(.+?)\]\]/g, '<mark>$1</mark>');
}

function position(index: number, total: number): string {
  if (total === 1) return 'single';
  if (index === 0) return 'first';
  return index === total - 1 ? 'last' : 'middle';
}

export function buildSlideHtml(
  template: string,
  tokens: string,
  slide: Slide,
  index: number,
  total: number,
  context: Record<string, string> = {},
): string {
  const values: Record<string, string> = {
    tokens,
    kicker: escapeHtml(slide.kicker),
    title: rich(slide.title),
    body: rich(slide.body),
    note: escapeHtml(slide.note ?? ''),
    source: escapeHtml(slide.source ?? ''),
    index: String(index + 1),
    total: String(total),
    position: position(index, total),
    service: '',
    seconds: '4',
  };
  for (const [key, value] of Object.entries(context)) values[key] = escapeHtml(value);
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

export function compositionData(service: string, slides: Slide[], secondsOf: (slide: Slide) => number): CompositionData {
  let start = 0;
  const scenes = slides.map((slide) => {
    const seconds = secondsOf(slide);
    const scene = {
      kicker: slide.kicker,
      title: slide.title,
      body: slide.body,
      note: slide.note ?? '',
      source: slide.source ?? '',
      start,
      seconds,
    };
    start = Math.round((start + seconds) * 10) / 10;
    return scene;
  });
  return { service, duration: start, scenes };
}

const GSAP_TAG = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"]*"><\/script>/;

export function gsapPath(): string {
  return createRequire(import.meta.url).resolve('gsap/dist/gsap.min.js');
}

export function localGsap(html: string, replacement: string): string {
  return html.replace(GSAP_TAG, () => replacement);
}

export function buildCompositionHtml(template: string, tokens: string, data: CompositionData): string {
  const values: Record<string, string> = {
    tokens,
    data: JSON.stringify(data).replace(/</g, '\\u003c'),
    duration: String(data.duration),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

async function load(page: Page, html: string): Promise<void> {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(
    (limit) =>
      Promise.race([
        document.fonts.ready.then(() => undefined),
        new Promise<void>((done) => setTimeout(done, limit)),
      ]),
    FONT_WAIT_MS,
  );
}

async function withBrowser<T>(
  executablePath: string | undefined,
  work: (browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ executablePath });
  try {
    return await work(browser);
  } finally {
    await browser.close();
  }
}

export function chromiumRenderer(executablePath: string | undefined): Renderer {
  return (jobs) =>
    withBrowser(executablePath, async (browser) => {
      for (const job of jobs) {
        mkdirSync(dirname(job.path), { recursive: true });
        const page = await browser.newPage({
          viewport: { width: job.width, height: job.height },
          deviceScaleFactor: 1,
        });
        await load(page, job.html);
        await page.screenshot({ path: job.path, type: 'jpeg', quality: 92 });
        await page.close();
      }
    });
}

function seek(milliseconds: number): void {
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = milliseconds;
  }
}

export function chromiumVideoRenderer(
  executablePath: string | undefined,
  ffmpegPath: string,
): VideoRenderer {
  return (job) =>
    withBrowser(executablePath, async (browser) => {
      mkdirSync(dirname(job.path), { recursive: true });
      const encoder = spawn(
        ffmpegPath,
        [
          '-y',
          '-loglevel', 'error',
          '-f', 'image2pipe',
          '-framerate', String(VIDEO_FPS),
          '-c:v', 'mjpeg',
          '-i', '-',
          '-f', 'lavfi',
          '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
          '-shortest',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '20',
          '-pix_fmt', 'yuv420p',
          '-r', String(VIDEO_FPS),
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          job.path,
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      let stderr = '';
      encoder.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      encoder.stdin.on('error', () => {});
      const finished = new Promise<void>((done, fail) => {
        encoder.on('error', (error: NodeJS.ErrnoException) =>
          fail(
            new Error(
              error.code === 'ENOENT'
                ? 'Falta ffmpeg en el servidor. Instálalo o define FFMPEG_PATH.'
                : error.message,
            ),
          ),
        );
        encoder.on('close', (code) =>
          code === 0 ? done() : fail(new Error(`ffmpeg falló: ${stderr.trim() || code}`)),
        );
      });
      finished.catch(() => {});

      try {
        for (const scene of job.scenes) {
          const page = await browser.newPage({
            viewport: { width: job.width, height: job.height },
            deviceScaleFactor: 1,
          });
          const session = await page.context().newCDPSession(page);
          await load(page, scene.html);
          const frames = Math.max(1, Math.round(scene.seconds * VIDEO_FPS));
          for (let frame = 0; frame < frames; frame += 1) {
            job.signal?.throwIfAborted();
            if (encoder.exitCode !== null) break;
            await page.evaluate(seek, (frame * 1000) / VIDEO_FPS);
            const shot = await session.send('Page.captureScreenshot', {
              format: 'jpeg',
              quality: 88,
              optimizeForSpeed: true,
            });
            const flushed = encoder.stdin.write(Buffer.from(shot.data, 'base64'));
            if (!flushed) await new Promise((done) => encoder.stdin.once('drain', done));
          }
          await page.close();
        }
        encoder.stdin.end();
        await finished;
      } catch (error) {
        encoder.kill('SIGKILL');
        throw error;
      }
    });
}
