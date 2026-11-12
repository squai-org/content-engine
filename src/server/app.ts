import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { type Context as Request, Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Context } from './agents.ts';
import type { ItemPatch } from './db.ts';
import { appConfigured, authorizeUrl, callbackUrl, CONNECTION_KEY, completeConnection } from './connections.ts';
import { ACTIONS, type Action, canHumanMove, isFormat, isStatus, sceneSeconds, type Slide } from './domain.ts';
import { fetchInsights, type Insights } from './insights.ts';
import {
  cancelJob,
  dispatchStatusHooks,
  fireHook,
  instagramAccount,
  instagramReady,
  nextSlot,
  requestRun,
  savedConnection,
} from './pipeline.ts';
import { buildCompositionHtml, buildSlideHtml, compositionData, gsapPath, localGsap } from './render.ts';
import { isKind, templateMeta } from './workspace.ts';

const COOKIE = 'ce_session';
const STATE_COOKIE = 'ce_oauth';
const STATE_SECONDS = 600;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.mp4', '.mov'];
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const TEXT_FIELDS = [
  'title',
  'message',
  'pillar',
  'service',
  'funnel',
  'cta',
  'copy',
  'notes',
  'first_comment',
] as const;
const INSIGHTS_KEY = 'insights';
const INSIGHTS_TTL_MS = 15 * 60 * 1000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PIECES = 21;
const SAMPLES = '_muestras';
const KEEP_SAMPLES = 6;

const SAMPLE_SLIDES: Slide[] = [
  {
    kicker: 'Guía',
    title: 'Un título con la [[frase clave]] resaltada',
    body: 'Línea de apoyo que explica la idea.',
    note: '(anotación breve y humana)',
    source: 'Fuente del dato, 2026',
  },
  {
    kicker: 'Paso 1',
    title: 'Primera idea, [[una sola]] por lámina',
    body: 'El apoyo desarrolla el título en dos o tres líneas, sin repetirlo.',
    note: 'Una nota al margen.',
    source: 'Fuente del dato, 2026',
  },
  {
    kicker: 'Paso 2',
    title: 'Segunda idea con [[énfasis]]',
    body: 'Texto de apoyo de ejemplo para medir cuánto cabe en la lámina.',
    note: 'Otra nota corta.',
    source: '',
  },
  {
    kicker: 'Paso 3',
    title: 'Tercera idea, [[directa]]',
    body: 'El contenido real lo escribe el agente al producir la pieza.',
    note: '',
    source: 'Fuente del dato, 2026',
  },
  {
    kicker: 'Paso 4',
    title: 'Cuarta idea para [[cerrar]] el argumento',
    body: 'Apoyo breve.',
    note: 'Última nota.',
    source: '',
  },
  {
    kicker: 'Cierre',
    title: 'El cierre con la [[llamada a la acción]]',
    body: 'Una línea que dice qué hacer ahora.',
    note: '',
    source: 'Fuentes del carrusel',
  },
];

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function sendFile(c: Request, root: string, relative: string): Response | null {
  const base = resolve(root);
  const path = resolve(base, normalize(relative).replace(/^([/\\])+/, ''));
  if (!path.startsWith(base) || !existsSync(path) || !statSync(path).isFile()) return null;
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const content = readFileSync(path);
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
  if (!range || (!range[1] && !range[2])) {
    return c.body(content, 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes' });
  }
  const size = content.length;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
  }
  return c.body(content.subarray(start, end + 1), 206, {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${size}`,
  });
}

export function createApp(ctx: Context, fetchImpl: typeof fetch = fetch): Hono {
  const { config, store, workspace } = ctx;
  const app = new Hono();
  const secure = config.publicUrl.startsWith('https://');

  app.onError((error, c) => c.json({ error: error.message }, 400));

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { password?: string };
    await new Promise((done) => setTimeout(done, 300));
    if (!timingSafeEqual(digest(body.password ?? ''), digest(config.adminPassword))) {
      return c.json({ error: 'Contraseña incorrecta.' }, 401);
    }
    await setSignedCookie(c, COOKIE, 'admin', config.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    const session = await getSignedCookie(c, config.sessionSecret, COOKIE);
    if (session !== 'admin') return c.json({ error: 'No autorizado.' }, 401);
    await next();
  });

  app.get('/api/status', (c) =>
    c.json({
      instagram: instagramReady(ctx),
      timezone: config.timezone,
      taxonomy: store.getTaxonomy(),
      planning: store.getPlanning(),
      paused: ctx.monitor.pausedReason(),
    }),
  );

  app.put('/api/planning', async (c) => {
    const body = (await c.req.json()) as { pieces?: unknown; slots?: unknown };
    const pieces = Math.min(MAX_PIECES, Math.max(1, Math.round(Number(body.pieces) || 1)));
    const slots = (Array.isArray(body.slots) ? body.slots : [])
      .map((slot: { weekday?: unknown; time?: unknown }) => ({
        weekday: Number(slot.weekday),
        time: String(slot.time ?? ''),
      }))
      .filter((slot) => slot.weekday >= 0 && slot.weekday <= 6 && TIME.test(slot.time))
      .sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time));
    store.setSetting('planning', { pieces, slots });
    return c.json(store.getPlanning());
  });

  app.get('/api/slots/next', (c) => {
    const taken = store
      .listItems()
      .filter((item) => item.scheduled_at && item.id !== c.req.query('except'))
      .map((item) => item.scheduled_at as string);
    return c.json({ at: nextSlot(store.getPlanning().slots, taken, new Date(), config.timezone) });
  });

  app.get('/api/server', (c) => c.json(ctx.monitor.snapshot()));

  app.get('/api/insights', async (c) => {
    if (!instagramReady(ctx)) return c.json({ error: 'Conecta Instagram para ver la analítica.' }, 409);
    const cached = store.getSetting<Insights | null>(INSIGHTS_KEY, null);
    const fresh = cached && Date.now() - cached.fetchedAt < INSIGHTS_TTL_MS;
    if (cached && fresh && c.req.query('refresh') !== '1') return c.json(cached);
    const insights = await fetchInsights(instagramAccount(ctx), fetchImpl);
    store.setSetting(INSIGHTS_KEY, insights);
    return c.json(insights);
  });

  app.post('/api/templates/preview', async (c) => {
    const body = (await c.req.json()) as { content?: string; service?: string };
    const content = body.content ?? '';
    const meta = templateMeta(content);
    if (!meta) {
      return c.json(
        { error: 'Al template le faltan las etiquetas meta "size" y "formats".' },
        400,
      );
    }
    const multiple = meta.formats.includes('carrusel') || meta.formats.includes('reel');
    const slides = multiple ? SAMPLE_SLIDES : SAMPLE_SLIDES.slice(0, 1);
    const tokens = workspace.tokens();
    const service = body.service ?? '';
    if (meta.engine === 'remotion') return c.json({ ...meta, slides: [] });
    if (meta.engine === 'hyperframes') {
      const html = buildCompositionHtml(content, tokens, compositionData(service, slides, sceneSeconds));
      return c.json({
        ...meta,
        slides: [
          localGsap(html, `<script>${readFileSync(gsapPath(), 'utf8')}</script>`).replace(
            /<head[^>]*>/i,
            (head) => `${head}<script>window.__preview=true</script>`,
          ),
        ],
      });
    }
    return c.json({
      ...meta,
      slides: slides.map((slide, index) =>
        buildSlideHtml(content, tokens, slide, index, slides.length, {
          service,
          seconds: String(sceneSeconds(slide)),
        }),
      ),
    });
  });

  let sampling = false;

  app.post('/api/templates/sample', async (c) => {
    const body = (await c.req.json()) as { content?: string; service?: string };
    const content = body.content ?? '';
    const service = body.service ?? '';
    const meta = templateMeta(content);
    if (!meta?.formats.includes('reel')) {
      return c.json({ error: 'Solo los templates de reel generan un video de muestra.' }, 400);
    }
    const name = `${createHash('sha256').update(`${service}\n${content}`).digest('hex').slice(0, 16)}.mp4`;
    const dir = join(config.dataDir, 'media', SAMPLES);
    const path = join(dir, name);
    const url = `/media/${SAMPLES}/${name}`;
    if (existsSync(path)) return c.json({ url });
    if (sampling) return c.json({ error: 'Ya hay una muestra renderizándose. Espera a que termine.' }, 409);
    sampling = true;
    try {
      mkdirSync(dir, { recursive: true });
      const scenes = SAMPLE_SLIDES.slice(0, 4);
      const size = { width: meta.width, height: meta.height, path };
      if (meta.engine === 'nativo') {
        const tokens = workspace.tokens();
        await ctx.video({
          ...size,
          scenes: scenes.map((slide, index) => {
            const seconds = sceneSeconds(slide);
            return {
              html: buildSlideHtml(content, tokens, slide, index, scenes.length, {
                service,
                seconds: String(seconds),
              }),
              seconds,
            };
          }),
        });
      } else {
        await ctx.compose({
          ...size,
          engine: meta.engine,
          template: content,
          data: compositionData(service, scenes, sceneSeconds),
        });
      }
      const old = readdirSync(dir)
        .map((file) => ({ file, at: statSync(join(dir, file)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
        .slice(KEEP_SAMPLES);
      for (const entry of old) rmSync(join(dir, entry.file), { force: true });
      return c.json({ url });
    } finally {
      sampling = false;
    }
  });

  function connectionInfo() {
    const saved = savedConnection(ctx);
    return {
      configured: appConfigured(config),
      redirectUri: callbackUrl(config),
      connected: instagramReady(ctx),
      username: saved?.username ?? null,
      expiresAt: saved?.expiresAt ?? null,
    };
  }

  app.get('/api/connections', (c) => c.json({ instagram: connectionInfo() }));

  app.post('/api/connections/instagram/start', async (c) => {
    if (!appConfigured(config)) {
      return c.json({ error: 'Falta IG_APP_ID, IG_APP_SECRET o IG_CONFIG_ID en el servidor.' }, 400);
    }
    const state = randomBytes(24).toString('hex');
    await setSignedCookie(c, STATE_COOKIE, state, config.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: STATE_SECONDS,
    });
    return c.json({ url: authorizeUrl(config, state) });
  });

  app.get('/api/connections/instagram/callback', async (c) => {
    const expected = await getSignedCookie(c, config.sessionSecret, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/' });
    const fail = (reason: string) => c.redirect(`/?conexion=error&motivo=${encodeURIComponent(reason)}`);
    const denied = c.req.query('error_description') ?? c.req.query('error');
    if (denied) return fail(denied);
    const code = c.req.query('code');
    if (!expected || c.req.query('state') !== expected || !code) {
      return fail('La autorización no es válida o expiró. Intenta de nuevo.');
    }
    try {
      store.setSetting(CONNECTION_KEY, await completeConnection(config, code, fetchImpl));
    } catch (error) {
      return fail((error as Error).message);
    }
    return c.redirect('/?conexion=ok');
  });

  app.delete('/api/connections/instagram', (c) => {
    store.setSetting(CONNECTION_KEY, null);
    store.setSetting(INSIGHTS_KEY, null);
    return c.json({ ok: true });
  });

  app.put('/api/taxonomy', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const clean = (value: unknown) =>
      Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
    const taxonomy = {
      pillars: clean(body.pillars),
      services: clean(body.services),
      funnel: clean(body.funnel),
      ctas: clean(body.ctas),
    };
    store.setSetting('taxonomy', taxonomy);
    return c.json(taxonomy);
  });

  app.get('/api/items', (c) => {
    const status = c.req.query('status');
    return c.json(
      store.listItems({
        from: c.req.query('from'),
        to: c.req.query('to'),
        status: isStatus(status) ? status : undefined,
      }),
    );
  });

  app.post('/api/items', async (c) => {
    const body = (await c.req.json()) as Record<string, string | null>;
    if (!body.title?.trim()) return c.json({ error: 'El título es obligatorio.' }, 400);
    const item = store.createItem({
      title: body.title.trim(),
      message: body.message ?? '',
      pillar: body.pillar ?? '',
      format: isFormat(body.format) ? body.format : 'post',
      service: body.service ?? '',
      funnel: body.funnel ?? '',
      cta: body.cta ?? '',
      scheduled_at: body.scheduled_at ?? null,
    });
    if (body.first_comment) store.updateItem(item.id, { first_comment: body.first_comment });
    dispatchStatusHooks(ctx, item);
    return c.json(item, 201);
  });

  app.get('/api/items/:id', (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    return c.json({ ...item, events: store.listEvents(item.id), job: store.latestJob(item.id) });
  });

  app.patch('/api/items/:id', async (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: ItemPatch = {};
    for (const field of TEXT_FIELDS) {
      if (typeof body[field] === 'string') patch[field] = body[field] as string;
    }
    if (isFormat(body.format)) patch.format = body.format;
    if (body.scheduled_at === null) patch.scheduled_at = null;
    if (typeof body.scheduled_at === 'string') {
      const date = new Date(body.scheduled_at);
      if (Number.isNaN(date.getTime())) return c.json({ error: 'Fecha inválida.' }, 400);
      patch.scheduled_at = date.toISOString();
    }
    const moved = isStatus(body.status) && body.status !== item.status ? body.status : null;
    if (moved) {
      if (!canHumanMove(item.status, moved)) {
        return c.json({ error: `No se puede pasar de ${item.status} a ${moved}.` }, 409);
      }
      const notes = patch.notes ?? item.notes;
      if (moved === 'ajustes' && !notes.trim()) {
        return c.json({ error: 'Escribe las anotaciones antes de pedir ajustes.' }, 400);
      }
      const scheduled = 'scheduled_at' in patch ? patch.scheduled_at : item.scheduled_at;
      if (moved === 'aprobada' && !scheduled) {
        return c.json({ error: 'Define fecha y hora antes de aprobar.' }, 400);
      }
      patch.status = moved;
      patch.error = null;
    }
    const updated = store.updateItem(item.id, patch);
    if (moved) {
      store.addEvent(item.id, 'estado', `${item.status} → ${moved}`);
      dispatchStatusHooks(ctx, updated);
    }
    return c.json(updated);
  });

  app.delete('/api/items/:id', (c) => {
    const id = c.req.param('id');
    if (!store.getItem(id)) return c.json({ ok: true });
    const active = store.latestJob(id);
    if (active) cancelJob(ctx, active.id);
    store.deleteItem(id);
    rmSync(join(config.dataDir, 'media', id), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  app.post('/api/items/:id/assets', async (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    const extension = extname(c.req.query('name') ?? '').toLowerCase();
    if (!UPLOAD_EXTENSIONS.includes(extension)) {
      return c.json({ error: `Formatos permitidos: ${UPLOAD_EXTENSIONS.join(', ')}.` }, 400);
    }
    const asset = `${item.id}/upload-${Date.now()}${extension}`;
    const path = join(config.dataDir, 'media', asset);
    mkdirSync(join(config.dataDir, 'media', item.id), { recursive: true });
    writeFileSync(path, Buffer.from(await c.req.arrayBuffer()));
    const assets = c.req.query('mode') === 'append' ? [...item.assets, asset] : [asset];
    store.addEvent(item.id, 'archivo', asset);
    return c.json(store.updateItem(item.id, { assets }));
  });

  app.get('/api/files/:kind', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    return c.json(workspace.list(kind));
  });

  app.get('/api/files/:kind/:name', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    const content = workspace.read(kind, c.req.param('name'));
    if (content === null) return c.json({ error: 'No existe.' }, 404);
    return c.json({ name: c.req.param('name'), content });
  });

  app.put('/api/files/:kind/:name', async (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    const body = (await c.req.json()) as { content?: string };
    workspace.write(kind, c.req.param('name'), body.content ?? '');
    return c.json({ ok: true });
  });

  app.delete('/api/files/:kind/:name', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    workspace.remove(kind, c.req.param('name'));
    return c.json({ ok: true });
  });

  app.get('/api/hooks', (c) => c.json(store.listHooks()));

  app.patch('/api/hooks/:id', async (c) => {
    const hook = store.getHook(c.req.param('id'));
    if (!hook) return c.json({ error: 'No existe.' }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: Parameters<typeof store.updateHook>[1] = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.agent === 'string' && workspace.list('agents').includes(`${body.agent}.md`)) {
      patch.agent = body.agent;
    }
    if (typeof body.weekday === 'number' && body.weekday >= 0 && body.weekday <= 6) {
      patch.weekday = body.weekday;
    }
    if (typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
      patch.time = body.time;
    }
    store.updateHook(hook.id, patch);
    return c.json(store.getHook(hook.id));
  });

  app.post('/api/hooks/:id/fire', (c) => {
    const hook = store.getHook(c.req.param('id'));
    if (!hook || hook.trigger !== 'weekly') return c.json({ error: 'No existe.' }, 404);
    fireHook(ctx, hook);
    return c.json({ ok: true });
  });

  app.post('/api/items/:id/run', async (c) => {
    const body = (await c.req.json()) as { action?: Action };
    const action = body.action;
    if (!action || !ACTIONS.includes(action) || action === 'plan') {
      return c.json({ error: 'Acción inválida.' }, 400);
    }
    return c.json(requestRun(ctx, action, c.req.param('id')));
  });

  app.get('/api/jobs', (c) => c.json(store.listJobs()));

  app.get('/api/jobs/:id', (c) => {
    const job = store.getJob(c.req.param('id'));
    if (!job) return c.json({ error: 'No existe.' }, 404);
    const after = Number(c.req.query('after') ?? 0) || 0;
    return c.json({ job, events: store.listJobEvents(job.id, after) });
  });

  app.post('/api/jobs/:id/cancel', (c) => {
    const job = cancelJob(ctx, c.req.param('id'));
    if (!job) return c.json({ error: 'No existe.' }, 404);
    return c.json(job);
  });

  app.post('/api/jobs/:id/rerun', (c) => {
    const job = store.getJob(c.req.param('id'));
    if (!job) return c.json({ error: 'No existe.' }, 404);
    if (job.status === 'queued' || job.status === 'running') {
      return c.json({ error: 'La ejecución sigue en curso.' }, 409);
    }
    return c.json(requestRun(ctx, job.action, job.item_id));
  });

  app.get('/media/*', (c) => {
    const response = sendFile(c, join(config.dataDir, 'media'), c.req.path.slice('/media/'.length));
    return response ?? c.notFound();
  });

  app.get('*', (c) => {
    const response =
      sendFile(c, config.webDir, c.req.path === '/' ? 'index.html' : c.req.path) ??
      sendFile(c, config.webDir, 'index.html');
    return response ?? c.text('Ejecuta npm run build.', 503);
  });

  return app;
}
