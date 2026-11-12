import { type Context, runJob } from './agents.ts';
import { CONNECTION_KEY, type InstagramConnection } from './connections.ts';
import type { Hook, Job } from './db.ts';
import { type Action, type Item, RUNNABLE_FROM, type Slot } from './domain.ts';

const MAX_JOB_ATTEMPTS = 3;
const RETRY_MINUTES = 10;
const STALE_MS = 24 * 60 * 60 * 1000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function dispatchStatusHooks(ctx: Context, item: Item): void {
  for (const hook of ctx.store.listHooks()) {
    if (hook.enabled && hook.trigger === 'status' && hook.status === item.status) {
      ctx.store.enqueue(hook.action, hook.agent, item.id);
    }
  }
}

const running = new Map<string, AbortController>();

function restoreItem(ctx: Context, job: Job): void {
  const item = job.item_id ? ctx.store.getItem(job.item_id) : null;
  if (!item) return;
  if (item.status === 'produciendo') {
    ctx.store.updateItem(item.id, { status: item.iteration > 0 ? 'revision' : 'idea' });
  } else if (item.status === 'ajustes') {
    ctx.store.updateItem(item.id, { status: 'revision' });
  } else {
    return;
  }
  ctx.store.addEvent(item.id, 'cancelada', 'Ejecución del agente cancelada');
}

export function cancelJob(ctx: Context, id: string): Job | null {
  const job = ctx.store.getJob(id);
  if (!job) return null;
  if (job.status !== 'queued' && job.status !== 'running') return job;
  const controller = running.get(id);
  if (controller) {
    controller.abort();
  } else {
    ctx.store.cancelJob(id);
    ctx.store.addJobEvent(id, 'step', 'Cancelada', '');
    restoreItem(ctx, job);
  }
  return ctx.store.getJob(id);
}

export function requestRun(ctx: Context, action: Action, itemId: string | null): Job {
  const hook = ctx.store.listHooks().find((entry) => entry.action === action);
  if (!hook) throw new Error('Sin agente para la acción.');
  if (action === 'plan') return ctx.store.enqueue('plan', hook.agent, null) as Job;
  const item = itemId ? ctx.store.getItem(itemId) : null;
  if (!item) throw new Error('La pieza ya no existe.');
  if (!RUNNABLE_FROM[action].includes(item.status)) {
    throw new Error('La pieza no está en un estado que permita esta ejecución.');
  }
  if (action === 'revise' && !item.notes.trim()) {
    throw new Error('Escribe las anotaciones antes de pedir ajustes.');
  }
  const job = ctx.store.enqueue(action, hook.agent, item.id);
  if (!job) throw new Error('Ya hay una ejecución en curso para esta pieza.');
  ctx.store.updateItem(item.id, {
    status: action === 'produce' ? 'produciendo' : 'ajustes',
    error: null,
  });
  return job;
}

export async function workOnce(ctx: Context, now = new Date()): Promise<boolean> {
  const job = ctx.store.claimJob(now.toISOString());
  if (!job) return false;
  const controller = new AbortController();
  running.set(job.id, controller);
  try {
    const touched = await runJob(ctx, job, controller.signal);
    controller.signal.throwIfAborted();
    ctx.store.finishJob(job.id);
    for (const item of touched) dispatchStatusHooks(ctx, item);
  } catch (error) {
    const text = message(error);
    if (controller.signal.aborted) {
      ctx.store.cancelJob(job.id);
      ctx.store.addJobEvent(job.id, 'step', 'Cancelada', '');
      restoreItem(ctx, job);
    } else if (job.attempts < MAX_JOB_ATTEMPTS) {
      const runAfter = new Date(now.getTime() + job.attempts * RETRY_MINUTES * 60000);
      ctx.store.retryJob(job.id, text, runAfter.toISOString());
      ctx.store.addJobEvent(job.id, 'error', `Intento ${job.attempts} falló. Se reintenta.`, text);
    } else {
      ctx.store.failJob(job.id, text);
      ctx.store.addJobEvent(job.id, 'error', 'Falló', text);
      if (job.item_id && ctx.store.getItem(job.item_id)) {
        ctx.store.updateItem(job.item_id, { status: 'error', error: text });
        ctx.store.addEvent(job.item_id, 'error', text);
      }
    }
  } finally {
    running.delete(job.id);
  }
  return true;
}

export function localClock(now: Date, timezone: string): { date: string; weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    time: `${get('hour')}:${get('minute')}`,
  };
}

function zonedToUtc(date: string, time: string, timezone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const clock = localClock(guess, timezone);
  const shown = new Date(`${clock.date}T${clock.time}:00Z`);
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime()));
}

export function nextSlot(
  slots: Slot[],
  taken: string[],
  now: Date,
  timezone: string,
): string | null {
  const busy = new Set(taken.map((iso) => iso.slice(0, 16)));
  for (let offset = 0; offset < 28; offset += 1) {
    const clock = localClock(new Date(now.getTime() + offset * 86400000), timezone);
    const times = slots
      .filter((slot) => slot.weekday === clock.weekday)
      .map((slot) => slot.time)
      .sort();
    for (const time of times) {
      const candidate = zonedToUtc(clock.date, time, timezone);
      if (candidate > now && !busy.has(candidate.toISOString().slice(0, 16))) {
        return candidate.toISOString();
      }
    }
  }
  return null;
}

export function fireHook(ctx: Context, hook: Hook): void {
  ctx.store.enqueue(hook.action, hook.agent, null);
}

export function fireWeeklyHooks(ctx: Context, now = new Date()): void {
  const clock = localClock(now, ctx.config.timezone);
  for (const hook of ctx.store.listHooks()) {
    if (!hook.enabled || hook.trigger !== 'weekly' || hook.time === null) continue;
    if (hook.weekday !== clock.weekday || clock.time < hook.time) continue;
    if (hook.last_fired === clock.date) continue;
    ctx.store.updateHook(hook.id, { last_fired: clock.date });
    fireHook(ctx, hook);
  }
}

export function savedConnection(ctx: Context): InstagramConnection | null {
  return ctx.store.getSetting<InstagramConnection | null>(CONNECTION_KEY, null);
}

export function instagramAccount(ctx: Context) {
  const saved = savedConnection(ctx);
  return {
    graphUrl: ctx.config.igGraphUrl,
    userId: saved?.userId ?? ctx.config.igUserId,
    token: saved?.token ?? ctx.config.igAccessToken,
  };
}

export function instagramReady(ctx: Context, now = Date.now()): boolean {
  const saved = savedConnection(ctx);
  if (saved) return saved.expiresAt === null || saved.expiresAt > now;
  return Boolean(ctx.config.igUserId && ctx.config.igAccessToken);
}

export async function publishDue(ctx: Context, now = new Date()): Promise<void> {
  if (!instagramReady(ctx)) return;
  for (const item of ctx.store.dueItems(now.toISOString())) {
    if (now.getTime() - new Date(item.scheduled_at as string).getTime() > STALE_MS) {
      const text = 'La fecha venció hace más de 24 horas. Reprograma y aprueba de nuevo.';
      ctx.store.updateItem(item.id, { status: 'error', error: text });
      ctx.store.addEvent(item.id, 'error', text);
      continue;
    }
    ctx.store.updateItem(item.id, { status: 'publicando' });
    try {
      const published = await ctx.publish(instagramAccount(ctx), {
        format: item.format,
        caption: item.copy,
        firstComment: item.first_comment,
        mediaUrls: item.assets.map((asset) => `${ctx.config.publicUrl}/media/${asset}`),
      });
      ctx.store.updateItem(item.id, {
        status: 'publicada',
        permalink: published.permalink,
        error: null,
      });
      ctx.store.addEvent(item.id, 'publicada', published.permalink ?? published.id);
      if (published.warning) ctx.store.addEvent(item.id, 'aviso', published.warning);
    } catch (error) {
      const text = message(error);
      ctx.store.updateItem(item.id, { status: 'error', error: text });
      ctx.store.addEvent(item.id, 'error', text);
    }
  }
}

export function startPipeline(ctx: Context, paused: () => boolean = () => false): () => void {
  let working = false;
  let ticking = false;
  ctx.store.pruneJobs();
  const worker = setInterval(async () => {
    if (working || paused()) return;
    working = true;
    try {
      await workOnce(ctx);
    } finally {
      working = false;
    }
  }, 3000);
  const scheduler = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      fireWeeklyHooks(ctx);
      await publishDue(ctx);
    } catch (error) {
      console.error(message(error));
    } finally {
      ticking = false;
    }
  }, 30000);
  return () => {
    clearInterval(worker);
    clearInterval(scheduler);
  };
}
