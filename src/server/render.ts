import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import type { Edit, Slide } from './domain.ts';

export type RenderJob = { html: string; width: number; height: number; path: string };
export type Renderer = (jobs: RenderJob[]) => Promise<void>;

export type CompositionScene = Required<Slide> & { start: number; seconds: number };
export type CompositionData = {
  service: string;
  duration: number;
  scenes: CompositionScene[];
  footage?: { src: string; start: number };
  edit?: Edit;
};
export type CompositionJob = {
  template: string;
  data: CompositionData;
  width: number;
  height: number;
  path: string;
  footage?: string;
  signal?: AbortSignal;
};
export type MediaTools = {
  normalize: (source: string, target: string, signal?: AbortSignal) => Promise<number>;
  transcribe: (path: string, signal?: AbortSignal) => Promise<{ text: string; start: number; end: number }[]>;
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
    footage: data.footage?.src ?? '',
    media_start: String(data.footage?.start ?? 0),
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
