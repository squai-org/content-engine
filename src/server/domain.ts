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
export type Word = { text: string; start: number; end: number };
export type MomentKind = 'keyword' | 'zoom' | 'note';
export const MOMENT_KINDS: MomentKind[] = ['keyword', 'zoom', 'note'];
export type EditPlan = {
  trim: { start: number; end: number };
  fixes: { from: number; to: number; text: string }[];
  emphasis: number[];
  hook: string;
  cta: string;
  moments: { word: number; seconds: number; kind: MomentKind; text: string }[];
};
export type Edit = {
  hook: string;
  cta: string;
  words: (Word & { strong: boolean })[];
  captions: { start: number; end: number; words: number[] }[];
  moments: { start: number; seconds: number; kind: MomentKind; text: string }[];
};
export type Transcript = { duration: number; words: Word[] };
export type Spec = { template: string; slides: Slide[]; script: string; edit?: EditPlan };

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
  footage: string;
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

const CAPTION_WORDS = 3;
const CAPTION_CHARS = 16;
const CAPTION_GAP = 0.45;
const MIN_CUT_SECONDS = 3;
const MAX_MOMENTS = 10;
const MAX_HOOK_WORDS = 9;
const round = (value: number) => Math.round(value * 100) / 100;

export function normalizePlan(input: Partial<EditPlan>, transcript: Transcript): EditPlan {
  const last = transcript.words.length - 1;
  const index = (value: unknown) => Math.min(last, Math.max(0, Math.round(Number(value) || 0)));
  let start = Math.max(0, Number(input.trim?.start) || 0);
  let end = Math.min(transcript.duration, Number(input.trim?.end) || transcript.duration);
  if (end - start < MIN_CUT_SECONDS) {
    start = 0;
    end = transcript.duration;
  }
  return {
    trim: { start: round(start), end: round(end) },
    fixes: (Array.isArray(input.fixes) ? input.fixes : [])
      .map((fix) => ({ from: index(fix.from), to: index(fix.to), text: String(fix.text ?? '').trim() }))
      .filter((fix) => fix.to >= fix.from),
    emphasis: (Array.isArray(input.emphasis) ? input.emphasis : []).map(index),
    hook: String(input.hook ?? '').trim(),
    cta: String(input.cta ?? '').trim(),
    moments: (Array.isArray(input.moments) ? input.moments : [])
      .filter((moment) => MOMENT_KINDS.includes(moment.kind))
      .map((moment) => ({
        word: index(moment.word),
        seconds: Math.min(3, Math.max(1.2, Number(moment.seconds) || 2)),
        kind: moment.kind,
        text: moment.kind === 'zoom' ? '' : String(moment.text ?? '').trim(),
      })),
  };
}

export function planViolations(plan: EditPlan, copy: string): string[] {
  const problems = proposalViolations('reel', copy, [
    { kicker: '', title: plan.hook || 'x', body: plan.cta },
    ...plan.moments.map((moment) => ({ kicker: '', title: moment.text || 'x', body: '' })),
    { kicker: '', title: 'x', body: '' },
  ]);
  const words = plan.hook.replace(/\[\[|\]\]/g, '').split(/\s+/).filter(Boolean).length;
  if (!words) problems.push('Falta hook: el título que abre el video.');
  if (words > MAX_HOOK_WORDS) problems.push(`hook admite máximo ${MAX_HOOK_WORDS} palabras.`);
  if (plan.moments.length > MAX_MOMENTS) problems.push(`moments admite máximo ${MAX_MOMENTS}.`);
  if (plan.moments.some((moment) => moment.kind !== 'zoom' && !moment.text)) {
    problems.push('Cada moment de tipo keyword o note necesita text.');
  }
  return problems;
}

export function buildEdit(transcript: Transcript, plan: EditPlan): { duration: number; edit: Edit } {
  const fixed = new Map<number, EditPlan['fixes'][number]>();
  for (const fix of plan.fixes) fixed.set(fix.from, fix);
  const strong = new Set(plan.emphasis);
  const all: (Word & { strong: boolean; origin: number })[] = [];
  for (let index = 0; index < transcript.words.length; index += 1) {
    const fix = fixed.get(index);
    if (!fix) {
      all.push({ ...transcript.words[index], strong: strong.has(index), origin: index });
      continue;
    }
    const from = transcript.words[fix.from].start;
    const to = transcript.words[fix.to].end;
    const tokens = fix.text.split(/\s+/).filter(Boolean);
    const marked = Array.from({ length: fix.to - fix.from + 1 }, (_, offset) => fix.from + offset).some(
      (origin) => strong.has(origin),
    );
    tokens.forEach((text, position) => {
      all.push({
        text,
        start: round(from + ((to - from) * position) / tokens.length),
        end: round(from + ((to - from) * (position + 1)) / tokens.length),
        strong: marked,
        origin: fix.from,
      });
    });
    index = fix.to;
  }
  const { start, end } = plan.trim;
  const kept = all.filter((word) => word.start >= start - 0.05 && word.end <= end + 0.05);
  const words = kept.map((word) => ({
    text: word.text,
    start: round(Math.max(0, word.start - start)),
    end: round(word.end - start),
    strong: word.strong,
  }));
  const captions: Edit['captions'] = [];
  let group: number[] = [];
  const close = () => {
    if (!group.length) return;
    captions.push({ start: words[group[0]].start, end: round(words[group[group.length - 1]].end + 0.15), words: group });
    group = [];
  };
  words.forEach((word, index) => {
    const length = group.reduce((sum, entry) => sum + words[entry].text.length + 1, 0) + word.text.length;
    if (group.length && length > CAPTION_CHARS) close();
    group.push(index);
    const next = words[index + 1];
    if (group.length >= CAPTION_WORDS || /[.?!,;:]$/.test(word.text) || !next || next.start - word.end > CAPTION_GAP) {
      close();
    }
  });
  captions.forEach((caption, index) => {
    const next = captions[index + 1];
    if (next && next.start - caption.end < 0.6) caption.end = next.start;
  });
  const moments = plan.moments
    .map((moment) => {
      const word = all.find((entry) => entry.origin >= moment.word) ?? all[all.length - 1];
      return { start: round((word?.start ?? start) - start), seconds: moment.seconds, kind: moment.kind, text: moment.text };
    })
    .filter((moment) => moment.start >= 0 && moment.start < end - start)
    .sort((a, b) => a.start - b.start);
  return { duration: round(end - start), edit: { hook: plan.hook, cta: plan.cta, words, captions, moments } };
}
