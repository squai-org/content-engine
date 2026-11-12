export const STATUSES = [
  'idea',
  'produciendo',
  'revision',
  'ajustes',
  'aprobada',
  'publicando',
  'publicada',
  'error',
] as const;
export type Status = (typeof STATUSES)[number];

export const FORMATS = ['post', 'carrusel', 'reel', 'story'] as const;
export type Format = (typeof FORMATS)[number];

export const ACTIONS = ['plan', 'produce', 'revise'] as const;
export type Action = (typeof ACTIONS)[number];

export type Slide = { kicker: string; title: string; body: string; note?: string; source?: string };
export type Spec = { template: string; slides: Slide[]; script: string };

export type Item = {
  id: string;
  title: string;
  message: string;
  pillar: string;
  format: Format;
  service: string;
  funnel: string;
  cta: string;
  network: string;
  scheduled_at: string | null;
  status: Status;
  copy: string;
  spec: Spec | null;
  assets: string[];
  notes: string;
  iteration: number;
  permalink: string | null;
  error: string | null;
  first_comment: string;
  created_at: string;
  updated_at: string;
};

export type Taxonomy = { pillars: string[]; services: string[]; funnel: string[]; ctas: string[] };
export type Slot = { weekday: number; time: string };
export type Planning = { pieces: number; slots: Slot[] };

export const DEFAULT_PLANNING: Planning = {
  pieces: 4,
  slots: [
    { weekday: 1, time: '12:00' },
    { weekday: 3, time: '12:00' },
    { weekday: 5, time: '12:00' },
  ],
};

export const RUNNABLE_FROM: Record<Exclude<Action, 'plan'>, Status[]> = {
  produce: ['idea', 'revision', 'error'],
  revise: ['revision', 'ajustes'],
};

export const DEFAULT_TAXONOMY: Taxonomy = {
  pillars: [
    'Entender la IA',
    'IA en el trabajo',
    'Anti-humo',
    'Adopción en organizaciones',
    'Detrás de Squai',
  ],
  services: ['One', 'Grow', 'Learn'],
  funnel: ['TOFU', 'MOFU', 'BOFU'],
  ctas: ['Lista de espera', 'Inscripción', 'Diagnóstico'],
};

const HUMAN_TRANSITIONS: Record<Status, Status[]> = {
  idea: [],
  produciendo: [],
  revision: ['ajustes', 'aprobada'],
  ajustes: [],
  aprobada: ['revision'],
  publicando: [],
  publicada: [],
  error: ['idea', 'revision', 'aprobada'],
};

export function canHumanMove(from: Status, to: Status): boolean {
  return HUMAN_TRANSITIONS[from].includes(to);
}

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}

export function isFormat(value: unknown): value is Format {
  return FORMATS.includes(value as Format);
}

const FORMAT_ALIASES: Record<string, Format> = {
  carousel: 'carrusel',
  imagen: 'post',
  image: 'post',
  historia: 'story',
  historias: 'story',
  stories: 'story',
  video: 'reel',
  reels: 'reel',
};

export function normalizeFormat(value: unknown): Format | null {
  const key = String(value ?? '').trim().toLowerCase();
  if (isFormat(key)) return key;
  return FORMAT_ALIASES[key] ?? null;
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 30;

export function proposalViolations(format: Format, copy: string, slides: Slide[]): string[] {
  const problems: string[] = [];
  if (!copy.trim()) problems.push('El copy está vacío.');
  if (copy.length > MAX_CAPTION) problems.push(`El copy supera ${MAX_CAPTION} caracteres.`);
  if ((copy.match(EMOJI) ?? []).length > 1) problems.push('El copy admite máximo un emoji.');
  if ((copy.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > MAX_HASHTAGS) {
    problems.push(`El copy supera ${MAX_HASHTAGS} hashtags.`);
  }
  const visualText = slides
    .map((slide) => `${slide.kicker} ${slide.title} ${slide.body} ${slide.note ?? ''} ${slide.source ?? ''}`)
    .join(' ');
  if (EMOJI.test(visualText)) problems.push('La pieza visual no admite emojis.');
  EMOJI.lastIndex = 0;
  if (format === 'carrusel' && (slides.length < 2 || slides.length > 10)) {
    problems.push('Un carrusel necesita entre 2 y 10 láminas.');
  }
  if ((format === 'post' || format === 'story') && slides.length !== 1) {
    problems.push('Un post o story necesita exactamente una lámina.');
  }
  if (format === 'reel' && (slides.length < 3 || slides.length > 9)) {
    problems.push('Un reel necesita entre 3 y 9 escenas en slides.');
  }
  if (slides.some((slide) => !slide.title.trim())) problems.push('Cada lámina necesita título.');
  return problems;
}

const WORDS_PER_SECOND = 3;
const MIN_SCENE_SECONDS = 2.5;
const MAX_SCENE_SECONDS = 7;

export function sceneSeconds(slide: Slide): number {
  const words = `${slide.kicker} ${slide.title} ${slide.body} ${slide.note ?? ''}`
    .replace(/\[\[|\]\]/g, '')
    .split(/\s+/)
    .filter(Boolean).length;
  const seconds = 1.2 + words / WORDS_PER_SECOND;
  return Math.round(Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, seconds)) * 10) / 10;
}
