import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Config } from './config.ts';
import type { Monitor } from './monitor.ts';
import type { Job, Store } from './db.ts';
import {
  buildEdit,
  type EditPlan,
  FORMATS,
  type Item,
  MOMENT_KINDS,
  normalizeFormat,
  normalizePlan,
  planViolations,
  proposalViolations,
  sceneSeconds,
  type Slide,
  type Transcript,
} from './domain.ts';
import type { Publish } from './publisher.ts';
import {
  buildSlideHtml,
  type Composer,
  compositionData,
  type MediaTools,
  type Renderer,
} from './render.ts';
import type { Workspace } from './workspace.ts';

export type AgentEvent = {
  kind: 'prompt' | 'text' | 'thinking' | 'tool' | 'tool_result' | 'step' | 'error';
  name: string;
  body: string;
};
export type ExecutorInput = {
  agent: string;
  prompt: string;
  schema: object;
  cwd: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};
export type Executor = (input: ExecutorInput) => Promise<unknown>;

export type Context = {
  config: Config;
  store: Store;
  workspace: Workspace;
  executor: Executor;
  renderer: Renderer;
  compose: Composer;
  media: MediaTools;
  publish: Publish;
  monitor: Monitor;
};

const TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'];
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const MAX_RESULT_CHARS = 6000;
const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const SLIDES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      kicker: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      note: { type: 'string' },
      source: { type: 'string' },
    },
    required: ['kicker', 'title', 'body', 'note', 'source'],
    additionalProperties: false,
  },
};

const PROPOSAL_PROPERTIES = {
  copy: { type: 'string' },
  template: { type: 'string' },
  slides: SLIDES_SCHEMA,
  script: { type: 'string' },
};

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: PROPOSAL_PROPERTIES,
  required: ['copy', 'template', 'slides', 'script'],
  additionalProperties: false,
};

const REVISION_SCHEMA = {
  type: 'object',
  properties: { ...PROPOSAL_PROPERTIES, learning: { type: 'string' } },
  required: ['copy', 'template', 'slides', 'script', 'learning'],
  additionalProperties: false,
};

const INDEX = { type: 'integer', minimum: 0 };
const EDIT_PROPERTIES = {
  copy: { type: 'string' },
  template: { type: 'string' },
  script: { type: 'string' },
  trim: {
    type: 'object',
    properties: { start: { type: 'number' }, end: { type: 'number' } },
    required: ['start', 'end'],
    additionalProperties: false,
  },
  fixes: {
    type: 'array',
    items: {
      type: 'object',
      properties: { from: INDEX, to: INDEX, text: { type: 'string' } },
      required: ['from', 'to', 'text'],
      additionalProperties: false,
    },
  },
  emphasis: { type: 'array', items: INDEX },
  hook: { type: 'string' },
  cta: { type: 'string' },
  moments: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        word: INDEX,
        seconds: { type: 'number' },
        kind: { type: 'string', enum: MOMENT_KINDS },
        text: { type: 'string' },
      },
      required: ['word', 'seconds', 'kind', 'text'],
      additionalProperties: false,
    },
  },
};
const EDIT_REQUIRED = ['copy', 'template', 'script', 'trim', 'fixes', 'emphasis', 'hook', 'cta', 'moments'];
const EDIT_SCHEMA = {
  type: 'object',
  properties: EDIT_PROPERTIES,
  required: EDIT_REQUIRED,
  additionalProperties: false,
};
const EDIT_REVISION_SCHEMA = {
  type: 'object',
  properties: { ...EDIT_PROPERTIES, learning: { type: 'string' } },
  required: [...EDIT_REQUIRED, 'learning'],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          message: { type: 'string' },
          pillar: { type: 'string' },
          format: { type: 'string', enum: [...FORMATS] },
          service: { type: 'string' },
          funnel: { type: 'string' },
          cta: { type: 'string' },
          scheduled_at: { type: 'string' },
        },
        required: [
          'title',
          'message',
          'pillar',
          'format',
          'service',
          'funnel',
          'cta',
          'scheduled_at',
        ],
        additionalProperties: false,
      },
    },
    research: { type: 'string' },
  },
  required: ['items', 'research'],
  additionalProperties: false,
};

type Proposal = { copy: string; template: string; slides: Slide[]; script: string };
type Revision = Proposal & { learning: string };
type EditProposal = EditPlan & { copy: string; template: string; script: string; learning?: string };
type Plan = { items: Record<string, string>[]; research: string };

type Block = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
};
type StreamLine = {
  type?: string;
  message?: { content?: Block[] | string };
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
};

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: Block) => (typeof part === 'string' ? part : (part.text ?? '')))
    .join('\n');
}

export function agentEvents(line: StreamLine): AgentEvent[] {
  const content = line.message?.content;
  if (!Array.isArray(content)) return [];
  const events: AgentEvent[] = [];
  for (const block of content) {
    if (line.type === 'assistant' && block.type === 'text' && block.text?.trim()) {
      events.push({ kind: 'text', name: '', body: block.text });
    } else if (line.type === 'assistant' && block.type === 'thinking' && block.thinking?.trim()) {
      events.push({ kind: 'thinking', name: '', body: block.thinking });
    } else if (line.type === 'assistant' && block.type === 'tool_use') {
      events.push({ kind: 'tool', name: block.name ?? '', body: JSON.stringify(block.input ?? {}) });
    } else if (line.type === 'user' && block.type === 'tool_result') {
      events.push({
        kind: 'tool_result',
        name: block.is_error ? 'error' : '',
        body: blockText(block.content).slice(0, MAX_RESULT_CHARS),
      });
    }
  }
  return events;
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Claude no devolvió JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

export function parseClaudeOutput(stdout: string): unknown {
  const output = JSON.parse(stdout) as StreamLine;
  if (output.is_error) throw new Error(output.result ?? 'Claude devolvió un error.');
  if (output.structured_output !== undefined) return output.structured_output;
  return extractJson(output.result ?? '');
}

export function claudeExecutor(bin: string): Executor {
  return ({ agent, prompt, schema, cwd, signal, onEvent }) =>
    new Promise((resolve, reject) => {
      const contract = [
        prompt,
        'Responde únicamente con un objeto JSON válido, sin texto adicional, que cumpla este JSON Schema:',
        JSON.stringify(schema),
      ].join('\n\n');
      const args = [
        '-p',
        contract,
        '--agent',
        agent,
        '--output-format',
        'stream-json',
        '--verbose',
        '--allowedTools',
        ...TOOLS,
      ];
      if (signal?.aborted) {
        reject(new Error('Ejecución cancelada.'));
        return;
      }
      const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let pending = '';
      let stderr = '';
      let lastText = '';
      let result: StreamLine | null = null;
      let timedOut = false;
      const stop = () => child.kill('SIGTERM');
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, TIMEOUT_MS);
      signal?.addEventListener('abort', stop, { once: true });

      function read(raw: string): void {
        if (!raw.trim()) return;
        let line: StreamLine;
        try {
          line = JSON.parse(raw) as StreamLine;
        } catch {
          return;
        }
        if (line.type === 'result') result = line;
        for (const event of agentEvents(line)) {
          if (event.kind === 'text') lastText = event.body;
          onEvent?.(event);
        }
      }

      child.stdout.on('data', (chunk: Buffer) => {
        pending += chunk.toString();
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(read);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        read(pending);
        if (signal?.aborted) return reject(new Error('Ejecución cancelada.'));
        if (timedOut) return reject(new Error('El agente superó el tiempo máximo de 20 minutos.'));
        const final = result as StreamLine | null;
        if (!final) return reject(new Error(stderr.trim() || `Claude terminó con código ${code}.`));
        if (final.is_error) return reject(new Error(final.result ?? 'Claude devolvió un error.'));
        try {
          if (final.structured_output !== undefined) return resolve(final.structured_output);
          try {
            resolve(extractJson(final.result ?? ''));
          } catch {
            resolve(extractJson(lastText));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
}

function itemBrief(item: Item): string {
  return JSON.stringify(
    {
      titulo: item.title,
      mensaje: item.message,
      pilar: item.pillar,
      formato: item.format,
      servicio: item.service,
      etapa: item.funnel,
      cta: item.cta,
      fecha: item.scheduled_at,
    },
    null,
    2,
  );
}

const FORMAT_RULES = [
  'Reglas del formato:',
  '- Cada lámina lleva kicker, title, body, note y source. Deja en cadena vacía lo que no uses.',
  '- En title puedes resaltar una sola frase con dobles corchetes: [[frase clave]].',
  '- note es una anotación breve y humana. source es la fuente verificable de un dato; sin dato, vacío.',
  '- Si el formato es reel: aplica la skill video-reel y lee bases/sistema-de-video.md. Escribe el guion completo en script y divide el video en 3 a 9 escenas dentro de slides, con el texto que aparece en pantalla en cada una. El servidor anima y exporta el video.',
  '- Si el formato no es reel, deja script vacío.',
].join('\n');

function templatesBrief(ctx: Context, item: Item, footage = false): string {
  const names = ctx.workspace
    .templatesFor(item.format, footage)
    .map((template) => template.name);
  return names.length ? names.join(', ') : 'ninguno';
}

function producePrompt(ctx: Context, item: Item): string {
  return [
    'Crea la propuesta de esta pieza de Instagram.',
    'Lee todo bases/ antes de escribir. Aplica las skills copy-instagram y diseno-pieza.',
    `Pieza:\n${itemBrief(item)}`,
    `Templates disponibles en templates/ para este formato: ${templatesBrief(ctx, item)}.`,
    FORMAT_RULES,
    'Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

function revisePrompt(ctx: Context, item: Item): string {
  return [
    'Aplica las anotaciones del revisor humano a esta pieza de Instagram.',
    'Lee todo bases/ antes de escribir. Aplica la skill revision-ajustes.',
    `Pieza:\n${itemBrief(item)}`,
    `Propuesta actual:\n${JSON.stringify({ copy: item.copy, ...item.spec }, null, 2)}`,
    `Anotaciones:\n${item.notes}`,
    `Templates disponibles en templates/ para este formato: ${templatesBrief(ctx, item)}.`,
    FORMAT_RULES,
    'Cambia solo lo que piden las anotaciones. En learning resume en una frase la regla general que se aprende, o deja vacío si no hay.',
    'Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

const EDIT_RULES = [
  'Reglas de la edición:',
  '- Aplica la skill edicion-video y lee bases/sistema-de-video.md.',
  '- La transcripción trae una palabra por línea: índice, segundo de inicio y texto. Los índices de fixes, emphasis y moments son los de esa lista.',
  '- trim: segundo donde empieza y termina el video final. Quita silencios y arranques en falso del inicio y del final.',
  '- fixes: corrige palabras mal transcritas, nombres propios y puntuación. Cada fix reemplaza las palabras de from a to (incluidas) por text. No reescribas lo que la persona dijo.',
  '- emphasis: índices de las palabras que se resaltan en los subtítulos.',
  '- hook: título que abre el video, máximo 9 palabras, con una frase entre [[ ]].',
  '- moments: animaciones dentro del video, ancladas a la palabra donde aparecen. keyword muestra una etiqueta grande con text, note una anotación a mano con text, zoom acerca la imagen y lleva text vacío.',
  '- cta: la llamada a la acción del cierre, en una línea.',
  '- script: la transcripción corregida completa. copy: el texto de la publicación.',
].join('\n');

function transcriptBrief(transcript: Transcript): string {
  const lines = transcript.words.map((word, index) => `${index}\t${word.start.toFixed(2)}\t${word.text}`);
  return `Duración del video: ${transcript.duration.toFixed(1)} s.\nTranscripción (índice, inicio, palabra):\n${lines.join('\n')}`;
}

function editPrompt(ctx: Context, item: Item, transcript: Transcript): string {
  return [
    'Planifica la edición de este reel de Instagram a partir del video grabado.',
    'Lee todo bases/ antes de escribir. Aplica las skills copy-instagram y edicion-video.',
    `Pieza:\n${itemBrief(item)}`,
    transcriptBrief(transcript),
    `Templates disponibles en templates/ para video grabado: ${templatesBrief(ctx, item, true)}.`,
    EDIT_RULES,
    'Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

function editRevisePrompt(ctx: Context, item: Item, transcript: Transcript): string {
  return [
    'Aplica las anotaciones del revisor humano a la edición de este reel grabado.',
    'Lee todo bases/ antes de escribir. Aplica la skill revision-ajustes.',
    `Pieza:\n${itemBrief(item)}`,
    transcriptBrief(transcript),
    `Edición actual:\n${JSON.stringify({ copy: item.copy, template: item.spec?.template, script: item.spec?.script, ...item.spec?.edit }, null, 2)}`,
    `Anotaciones:\n${item.notes}`,
    `Templates disponibles en templates/ para video grabado: ${templatesBrief(ctx, item, true)}.`,
    EDIT_RULES,
    'Cambia solo lo que piden las anotaciones. En learning resume en una frase la regla general que se aprende, o deja vacío si no hay.',
    'Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

export function nextWeek(now: Date, timezone: string): { from: string; to: string } {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    now,
  );
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const untilMonday = ((8 - index) % 7) || 7;
  const day = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
      new Date(now.getTime() + offset * 86400000),
    );
  return { from: day(untilMonday), to: day(untilMonday + 6) };
}

function planPrompt(ctx: Context, from: string, to: string): string {
  const taxonomy = ctx.store.getTaxonomy();
  const planning = ctx.store.getPlanning();
  const slots = planning.slots
    .map((slot) => `${WEEKDAY_NAMES[slot.weekday]} ${slot.time}`)
    .join(', ');
  const scheduled = ctx.store
    .listItems({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` })
    .filter((item) => item.scheduled_at)
    .map((item) => `${item.scheduled_at} · ${item.format} · ${item.title}`);
  return [
    `Planifica la parrilla de Instagram del ${from} al ${to}. Zona horaria: ${ctx.config.timezone}.`,
    'Lee todo bases/ antes de planificar. Aplica la skill estrategia-parrilla.',
    `Pilares: ${taxonomy.pillars.join(', ')}.`,
    `Servicios: ${taxonomy.services.join(', ')}.`,
    `Etapas del embudo: ${taxonomy.funnel.join(', ')}.`,
    `Llamadas a la acción: ${taxonomy.ctas.join(', ')}.`,
    `Formatos: ${FORMATS.join(', ')}.`,
    `Cantidad: ${planning.pieces} piezas, salvo que bases/estrategia.md defina otro ritmo semanal.`,
    `Horarios preferidos de publicación: ${slots || 'libres'}.`,
    `Ya programado en ese rango:\n${scheduled.join('\n') || 'nada'}`,
    `Títulos recientes que no se repiten:\n${ctx.store.recentTitles(40).join('\n') || 'ninguno'}`,
    'En research escribe, en Markdown, lo que investigaste para esta semana: fechas que activan algo en el lector, noticias de IA que cambian algo concreto, y por qué elegiste cada ángulo. Cita la URL de cada hecho externo. Deja fuera lo que no puedas verificar.',
    'items es obligatorio y nunca va vacío. Si a las bases les falta información, planifica igual con los pilares, servicios y llamadas a la acción de este mensaje y anota en research qué supuesto tomaste. No respondas solo con research.',
    'scheduled_at va en ISO 8601 con offset de la zona horaria. Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

function normalizeSlides(slides: Slide[]): Slide[] {
  return slides.map((slide) => ({
    kicker: slide.kicker ?? '',
    title: slide.title ?? '',
    body: slide.body ?? '',
    note: slide.note ?? '',
    source: slide.source ?? '',
  }));
}

type Run = { ctx: Context; job: Job; signal?: AbortSignal };

function log(run: Run, kind: AgentEvent['kind'], name: string, body = ''): void {
  run.ctx.store.addJobEvent(run.job.id, kind, name, body);
}

function ask<T>(run: Run, prompt: string, schema: object): Promise<T> {
  log(run, 'prompt', run.job.agent, prompt);
  return run.ctx.executor({
    agent: run.job.agent,
    prompt,
    schema,
    cwd: run.ctx.workspace.root,
    signal: run.signal,
    onEvent: (event) => log(run, event.kind, event.name, event.body),
  }) as Promise<T>;
}

async function propose<T extends Proposal>(
  run: Run,
  item: Item,
  prompt: string,
  schema: object,
): Promise<T> {
  let feedback = '';
  let problems: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const output = await ask<T>(run, prompt + feedback, schema);
    output.slides = normalizeSlides(Array.isArray(output.slides) ? output.slides : []);
    problems = proposalViolations(item.format, output.copy ?? '', output.slides);
    if (item.format === 'reel' && !output.script?.trim()) problems.push('El reel necesita guion.');
    if (!problems.length) return output;
    log(run, 'step', 'La propuesta incumple reglas', problems.join('\n'));
    feedback = `\n\nTu respuesta anterior incumplió estas reglas, corrígelas:\n- ${problems.join('\n- ')}`;
  }
  throw new Error(`La propuesta incumple reglas: ${problems.join(' ')}`);
}

const MATERIAL = 'material';

async function prepareFootage(run: Run, item: Item): Promise<{ video: string; transcript: Transcript }> {
  const { ctx } = run;
  const dir = join(ctx.config.dataDir, 'media', item.id);
  const video = `${item.id}/${MATERIAL}.mp4`;
  const videoPath = join(dir, `${MATERIAL}.mp4`);
  const transcriptPath = join(dir, `${MATERIAL}.json`);
  if (item.footage !== video) {
    log(run, 'step', 'Preparando el video', 'Se convierte a 1080×1920, 30 fps.');
    rmSync(transcriptPath, { force: true });
    const source = join(ctx.config.dataDir, 'media', item.footage);
    const duration = await ctx.media.normalize(source, videoPath, run.signal);
    writeFileSync(transcriptPath, JSON.stringify({ duration, words: null }));
    ctx.store.updateItem(item.id, { footage: video });
    rmSync(source, { force: true });
  }
  const saved = JSON.parse(readFileSync(transcriptPath, 'utf8')) as { duration: number; words: Transcript['words'] | null };
  if (!saved.words) {
    log(run, 'step', 'Transcribiendo el audio', 'Whisper local, palabra por palabra.');
    saved.words = await ctx.media.transcribe(videoPath, run.signal);
    writeFileSync(transcriptPath, JSON.stringify(saved));
    log(run, 'step', 'Transcripción lista', `${saved.words.length} palabras`);
  }
  if (!saved.words.length) throw new Error('No se detectó voz en el video. Los subtítulos necesitan audio hablado.');
  return { video, transcript: { duration: saved.duration, words: saved.words } };
}

async function editFootage(run: Run, item: Item, revising: boolean): Promise<{ updated: Item; learning: string }> {
  const { ctx } = run;
  const { video, transcript } = await prepareFootage(run, item);
  const prompt = revising ? editRevisePrompt(ctx, item, transcript) : editPrompt(ctx, item, transcript);
  const schema = revising ? EDIT_REVISION_SCHEMA : EDIT_SCHEMA;
  let feedback = '';
  let problems: string[] = [];
  let output: EditProposal | null = null;
  let plan: EditPlan | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !plan; attempt += 1) {
    output = await ask<EditProposal>(run, prompt + feedback, schema);
    const candidate = normalizePlan(output, transcript);
    problems = planViolations(candidate, output.copy ?? '');
    if (!problems.length) plan = candidate;
    else {
      log(run, 'step', 'La edición incumple reglas', problems.join('\n'));
      feedback = `\n\nTu respuesta anterior incumplió estas reglas, corrígelas:\n- ${problems.join('\n- ')}`;
    }
  }
  if (!plan || !output) throw new Error(`La edición incumple reglas: ${problems.join(' ')}`);

  const template = ctx.workspace.pickTemplate(output.template ?? '', 'reel', true);
  const built = buildEdit(transcript, plan);
  const iteration = item.iteration + 1;
  const mediaDir = join(ctx.config.dataDir, 'media');
  const assets = [`${item.id}/v${iteration}.mp4`];
  run.signal?.throwIfAborted();
  log(
    run,
    'step',
    'Renderizando video',
    `${Math.round(built.duration)} s · ${built.edit.captions.length} subtítulos · ${built.edit.moments.length} animaciones · ${template.name}`,
  );
  await ctx.compose({
    template: ctx.workspace.read('templates', template.name) as string,
    data: {
      service: item.service,
      duration: built.duration,
      scenes: [],
      footage: { src: '', start: plan.trim.start },
      edit: built.edit,
    },
    width: template.width,
    height: template.height,
    path: join(mediaDir, assets[0]),
    footage: join(mediaDir, video),
    signal: run.signal,
  });
  pruneMedia(join(mediaDir, item.id), assets);
  const updated = ctx.store.updateItem(item.id, {
    copy: output.copy,
    spec: { template: template.name, slides: [], script: output.script ?? '', edit: plan },
    assets,
    iteration,
    status: 'revision',
    error: null,
  });
  return { updated, learning: output.learning?.trim() ?? '' };
}

function pruneMedia(dir: string, keep: string[]): void {
  if (!existsSync(dir)) return;
  const names = new Set(keep.map((asset) => basename(asset)));
  for (const name of readdirSync(dir)) {
    if (!names.has(name) && !name.startsWith(MATERIAL)) rmSync(join(dir, name), { force: true });
  }
}

async function applyProposal(run: Run, item: Item, proposal: Proposal): Promise<Item> {
  const { ctx } = run;
  const iteration = item.iteration + 1;
  const mediaDir = join(ctx.config.dataDir, 'media');
  let assets = item.assets;
  let templateName = '';
  if (proposal.slides.length) {
    const template = ctx.workspace.pickTemplate(proposal.template, item.format);
    const html = ctx.workspace.read('templates', template.name) as string;
    const tokens = ctx.workspace.tokens();
    const total = proposal.slides.length;
    const build = (slide: Slide, index: number) =>
      buildSlideHtml(html, tokens, slide, index, total, { service: item.service });
    templateName = template.name;
    run.signal?.throwIfAborted();
    if (item.format === 'reel') {
      assets = [`${item.id}/v${iteration}.mp4`];
      const data = compositionData(item.service, proposal.slides, sceneSeconds);
      log(run, 'step', 'Renderizando video', `${total} escenas · ${Math.round(data.duration)} s · ${template.name}`);
      await ctx.compose({
        template: html,
        data,
        width: template.width,
        height: template.height,
        path: join(mediaDir, assets[0]),
        signal: run.signal,
      });
    } else {
      assets = proposal.slides.map((_, index) => `${item.id}/v${iteration}-${index + 1}.jpg`);
      log(run, 'step', 'Renderizando láminas', `${total} · ${template.name}`);
      await ctx.renderer(
        proposal.slides.map((slide, index) => ({
          html: build(slide, index),
          width: template.width,
          height: template.height,
          path: join(mediaDir, assets[index]),
        })),
      );
    }
    pruneMedia(join(mediaDir, item.id), assets);
  }
  return ctx.store.updateItem(item.id, {
    copy: proposal.copy,
    spec: { template: templateName, slides: proposal.slides, script: proposal.script ?? '' },
    assets,
    iteration,
    status: 'revision',
    error: null,
  });
}

function requireItem(ctx: Context, job: Job): Item {
  const item = job.item_id ? ctx.store.getItem(job.item_id) : null;
  if (!item) throw new Error('La pieza ya no existe.');
  return item;
}

async function produce(run: Run): Promise<Item[]> {
  const { ctx, job } = run;
  const item = requireItem(ctx, job);
  if (item.status !== 'idea' && item.status !== 'produciendo') return [];
  ctx.store.updateItem(item.id, { status: 'produciendo' });
  const updated =
    item.format === 'reel' && item.footage
      ? (await editFootage(run, item, false)).updated
      : await applyProposal(
          run,
          item,
          await propose<Proposal>(run, item, producePrompt(ctx, item), PROPOSAL_SCHEMA),
        );
  ctx.store.addEvent(item.id, 'propuesta', `Versión ${updated.iteration}`);
  log(run, 'step', 'Propuesta lista', `Versión ${updated.iteration}`);
  return [updated];
}

async function revise(run: Run): Promise<Item[]> {
  const { ctx, job } = run;
  const item = requireItem(ctx, job);
  if (item.status !== 'ajustes') return [];
  let updated: Item;
  let learning: string;
  if (item.format === 'reel' && item.footage) {
    ({ updated, learning } = await editFootage(run, item, true));
  } else {
    const revision = await propose<Revision>(run, item, revisePrompt(ctx, item), REVISION_SCHEMA);
    updated = await applyProposal(run, item, revision);
    learning = revision.learning?.trim() ?? '';
  }
  ctx.store.addEvent(item.id, 'ajustes', item.notes);
  ctx.store.updateItem(item.id, { notes: '' });
  if (learning) ctx.workspace.appendLearning(learning);
  log(run, 'step', 'Ajustes aplicados', learning);
  return [{ ...updated, notes: '' }];
}

async function plan(run: Run): Promise<Item[]> {
  const { ctx } = run;
  const { from, to } = nextWeek(new Date(), ctx.config.timezone);
  const prompt = planPrompt(ctx, from, to);
  let output = await ask<Plan>(run, prompt, PLAN_SCHEMA);
  if (!Array.isArray(output.items) || !output.items.length) {
    log(run, 'step', 'El planner no propuso ideas', 'Se le pide de nuevo, sin repetir la investigación.');
    const research = String(output.research ?? '').slice(0, MAX_RESULT_CHARS);
    const retry = await ask<Plan>(
      run,
      [
        prompt,
        'Tu respuesta anterior dejó items vacío. Eso no sirve: la parrilla necesita ideas concretas.',
        research
          ? `Ya investigaste. No repitas la búsqueda; usa este research y devuélvelo igual en research:\n${research}`
          : '',
        'Devuelve ahora el JSON con items lleno.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      PLAN_SCHEMA,
    );
    output = { items: retry.items, research: retry.research?.trim() ? retry.research : output.research };
  }
  if (output.research?.trim()) {
    ctx.workspace.write(
      'bases',
      'research-semanal.md',
      `# Research semanal\n\nSemana del ${from} al ${to}. Lo escribe el planner y se reemplaza cada semana.\n\n${output.research.trim()}\n`,
    );
  }
  const ideas = Array.isArray(output.items) ? output.items : [];
  const created: Item[] = [];
  const rejected: string[] = [];
  for (const idea of ideas) {
    const title = String(idea.title ?? '').trim();
    const format = normalizeFormat(idea.format);
    const date = new Date(idea.scheduled_at);
    if (!title) {
      rejected.push('una idea sin título');
      continue;
    }
    if (!format) {
      rejected.push(`"${title}" con formato "${idea.format}"`);
      continue;
    }
    if (Number.isNaN(date.getTime())) {
      rejected.push(`"${title}" con fecha "${idea.scheduled_at}"`);
      continue;
    }
    created.push(
      ctx.store.createItem({
        title,
        message: idea.message,
        pillar: idea.pillar,
        format,
        service: idea.service,
        funnel: idea.funnel,
        cta: idea.cta,
        scheduled_at: date.toISOString(),
      }),
    );
  }
  if (rejected.length) log(run, 'step', 'Ideas descartadas', rejected.join('\n'));
  if (!created.length) {
    const detail = ideas.length
      ? `descartó ${rejected.slice(0, 3).join('; ')}`
      : 'no propuso ninguna idea en dos intentos. Abre la ejecución en Actividad para leer su razonamiento';
    throw new Error(`El planner no devolvió ideas válidas: ${detail}`);
  }
  log(run, 'step', 'Parrilla creada', created.map((item) => `${item.format} · ${item.title}`).join('\n'));
  return created;
}

export async function runJob(ctx: Context, job: Job, signal?: AbortSignal): Promise<Item[]> {
  const run: Run = { ctx, job, signal };
  if (job.action === 'plan') return plan(run);
  if (job.action === 'produce') return produce(run);
  return revise(run);
}
