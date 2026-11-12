import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  agentEvents,
  type Context,
  type Executor,
  nextWeek,
  parseClaudeOutput,
} from '../src/server/agents.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createStore } from '../src/server/db.ts';
import { canHumanMove, proposalViolations, sceneSeconds } from '../src/server/domain.ts';
import { fetchInsights } from '../src/server/insights.ts';
import {
  cancelJob,
  fireWeeklyHooks,
  instagramAccount,
  instagramReady,
  localClock,
  nextSlot,
  publishDue,
  savedConnection,
  workOnce,
} from '../src/server/pipeline.ts';
import { instagramPublisher, type Publication } from '../src/server/publisher.ts';
import { addEgress, createMonitor, transmittedBytes } from '../src/server/monitor.ts';
import { buildSlideHtml, type RenderJob, type VideoJob } from '../src/server/render.ts';
import { createWorkspace, syncSeed } from '../src/server/workspace.ts';

const slide = { kicker: 'Anti-humo', title: 'La IA no piensa por ti', body: 'Genera volumen.' };
const proposal = {
  copy: 'Tesis directa.\n\nLista de espera en el perfil.',
  template: 'editorial.html',
  slides: [slide, { ...slide, title: 'Qué delegar' }],
  script: '',
};

function setup(executor: Executor, env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ce-'));
  const rendered: RenderJob[] = [];
  const published: Publication[] = [];
  const videos: VideoJob[] = [];
  const config = loadConfig({
    ADMIN_PASSWORD: 'clave',
    SESSION_SECRET: 'secreto',
    DATA_DIR: dataDir,
    PUBLIC_URL: 'https://ce.test',
    ...env,
  });
  const store = createStore(':memory:');
  const ctx: Context = {
    config: { ...config, seedDir: resolve('seed') },
    store,
    workspace: createWorkspace(join(dataDir, 'workspace'), resolve('seed')),
    executor,
    renderer: async (jobs) => {
      rendered.push(...jobs);
    },
    video: async (job) => {
      videos.push(job);
    },
    publish: async (_account, publication) => {
      published.push(publication);
      return { id: '1', permalink: 'https://instagram.com/p/x' };
    },
    monitor: createMonitor(config, store),
  };
  ctx.monitor.stop();
  return { ctx, rendered, published, videos };
}

async function login(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'clave' }),
  });
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

test('transiciones humanas', () => {
  assert.equal(canHumanMove('revision', 'aprobada'), true);
  assert.equal(canHumanMove('revision', 'ajustes'), true);
  assert.equal(canHumanMove('idea', 'aprobada'), false);
  assert.equal(canHumanMove('publicada', 'revision'), false);
});

test('reglas de la propuesta', () => {
  assert.deepEqual(proposalViolations('carrusel', 'Copy 🙂', proposal.slides), []);
  assert.equal(proposalViolations('carrusel', 'Copy 🙂🙂', proposal.slides).length, 1);
  assert.equal(proposalViolations('post', 'Copy', [{ ...slide, title: 'Hola 🚀' }]).length, 1);
  assert.equal(proposalViolations('carrusel', 'Copy', [slide]).length, 1);
  assert.equal(proposalViolations('post', '', [slide]).length, 1);
});

test('html de lámina escapa contenido', () => {
  const html = buildSlideHtml('<b class="{{position}}">{{title}}</b>{{index}}/{{total}}', '', {
    ...slide,
    title: '<script>x</script>',
  }, 0, 3);
  assert.equal(html, '<b class="first">&lt;script&gt;x&lt;/script&gt;</b>1/3');
});

test('salida de claude', () => {
  assert.deepEqual(parseClaudeOutput('{"structured_output":{"a":1},"result":""}'), { a: 1 });
  assert.deepEqual(parseClaudeOutput('{"result":"texto {\\"a\\":2} fin"}'), { a: 2 });
  assert.throws(() => parseClaudeOutput('{"is_error":true,"result":"límite"}'), /límite/);
});

test('semana siguiente y reloj local', () => {
  const wednesday = new Date('2026-11-11T15:00:00Z');
  assert.deepEqual(nextWeek(wednesday, 'America/Bogota'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(localClock(new Date('2026-11-16T02:30:00Z'), 'America/Bogota'), {
    date: '2026-11-15',
    weekday: 0,
    time: '21:30',
  });
});

test('idea → propuesta → ajustes → aprobada → publicada', async () => {
  const prompts: string[] = [];
  const { ctx, rendered, published } = setup(
    async ({ prompt }) => {
      prompts.push(prompt);
      return prompt.includes('Anotaciones')
        ? { ...proposal, copy: 'Copy ajustado.', learning: 'Evitar la palabra revolución.' }
        : structuredClone(proposal);
    },
    { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' },
  );
  const app = createApp(ctx);
  const cookie = await login(app);
  const headers = { cookie };

  const created = await app.request('/api/items', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Mito del reemplazo', format: 'carrusel' }),
  });
  const { id } = (await created.json()) as { id: string };
  assert.equal(await workOnce(ctx), true);
  let item = ctx.store.getItem(id);
  assert.equal(item?.status, 'revision');
  assert.equal(item?.assets.length, 2);
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].width, 1080);
  assert.match(rendered[0].html, /La IA no piensa por ti/);

  const denied = await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'ajustes' }),
  });
  assert.equal(denied.status, 400);

  await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'ajustes', notes: 'Quita revolución.' }),
  });
  assert.equal(await workOnce(ctx), true);
  item = ctx.store.getItem(id);
  assert.equal(item?.status, 'revision');
  assert.equal(item?.copy, 'Copy ajustado.');
  assert.equal(item?.iteration, 2);
  assert.equal(item?.notes, '');
  assert.match(prompts[1], /Quita revolución/);
  assert.match(
    readFileSync(join(ctx.workspace.root, 'bases/aprendizajes.md'), 'utf8'),
    /Evitar la palabra revolución/,
  );

  const unscheduled = await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'aprobada' }),
  });
  assert.equal(unscheduled.status, 400);

  const when = new Date(Date.now() - 60000).toISOString();
  const approved = await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'aprobada', scheduled_at: when }),
  });
  assert.equal(approved.status, 200);
  await publishDue(ctx);
  item = ctx.store.getItem(id);
  assert.equal(item?.status, 'publicada');
  assert.equal(item?.permalink, 'https://instagram.com/p/x');
  assert.equal(published[0].mediaUrls[0], `https://ce.test/media/${id}/v2-1.jpg`);
});

test('reintenta con las reglas incumplidas y falla a error', async () => {
  const prompts: string[] = [];
  const { ctx } = setup(async ({ prompt }) => {
    prompts.push(prompt);
    return { ...proposal, copy: 'Uno 🙂 dos 🙂' };
  });
  const item = ctx.store.createItem({ title: 'x', format: 'carrusel' });
  ctx.store.enqueue('produce', 'productor', item.id);
  await workOnce(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /máximo un emoji/);
  const later = new Date(Date.now() + 3600000);
  await workOnce(ctx, later);
  await workOnce(ctx, new Date(later.getTime() + 3600000));
  assert.equal(ctx.store.getItem(item.id)?.status, 'error');
  assert.equal(ctx.store.listJobs()[0].status, 'failed');
});

test('planner crea ideas y encola producción', async () => {
  const { ctx } = setup(async ({ agent }) =>
    agent === 'planner'
      ? {
          items: [
            {
              title: 'Idea 1',
              message: 'm',
              pillar: 'Anti-humo',
              format: 'post',
              service: 'One',
              funnel: 'TOFU',
              cta: 'Lista de espera',
              scheduled_at: '2026-11-17T12:00:00-05:00',
            },
            { title: 'Sin fecha', format: 'post', scheduled_at: 'mañana' },
            {
              title: 'Carrusel con mayúscula',
              message: 'm',
              pillar: 'Anti-humo',
              format: 'Carrusel',
              service: 'One',
              funnel: 'TOFU',
              cta: 'Lista de espera',
              scheduled_at: '2026-11-18T12:00:00-05:00',
            },
          ],
          research: '- Cierre de año: el lector planea 2027 (https://ejemplo.test/fuente).',
        }
      : { ...proposal, slides: [slide] },
  );
  fireWeeklyHooks(ctx, new Date('2026-11-15T23:30:00Z'));
  fireWeeklyHooks(ctx, new Date('2026-11-15T23:40:00Z'));
  assert.equal(ctx.store.listJobs().length, 1);
  await workOnce(ctx);
  const items = ctx.store.listItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].scheduled_at, '2026-11-17T17:00:00.000Z');
  assert.equal(items[1].format, 'carrusel');
  assert.equal(ctx.store.listJobs().filter((job) => job.action === 'produce').length, 2);
  const research = readFileSync(join(ctx.workspace.root, 'bases/research-semanal.md'), 'utf8');
  assert.match(research, /^# Research semanal\n\nSemana del 2026-11-1\d al 2026-11-2\d\./);
  assert.match(research, /Cierre de año/);
});

test('el error del planner explica qué descartó', async () => {
  const { ctx } = setup(async () => ({
    items: [{ title: 'Idea rara', format: 'Infografía', scheduled_at: '2026-11-17T12:00:00-05:00' }],
    research: '',
  }));
  ctx.store.enqueue('plan', 'planner', null);
  await workOnce(ctx);
  assert.match(ctx.store.listJobs()[0].error ?? '', /"Idea rara" con formato "Infografía"/);

  const empty = setup(async () => ({ ideas: [], research: '' })).ctx;
  empty.store.enqueue('plan', 'planner', null);
  await workOnce(empty);
  assert.match(empty.store.listJobs()[0].error ?? '', /no propuso ninguna idea en dos intentos/);
});

test('no publica piezas vencidas hace más de un día', async () => {
  const { ctx, published } = setup(async () => proposal, { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' });
  const item = ctx.store.createItem({
    title: 'x',
    scheduled_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  });
  ctx.store.updateItem(item.id, { status: 'aprobada' });
  await publishDue(ctx);
  assert.equal(published.length, 0);
  assert.equal(ctx.store.getItem(item.id)?.status, 'error');
});

test('api exige sesión y protege rutas de archivos', async () => {
  const { ctx } = setup(async () => proposal);
  const app = createApp(ctx);
  assert.equal((await app.request('/api/health')).status, 200);
  assert.equal((await app.request('/api/items')).status, 401);
  const bad = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'otra' }),
  });
  assert.equal(bad.status, 401);
  const headers = { cookie: await login(app) };
  assert.equal((await app.request('/api/files/skills', { headers })).status, 200);
  const traversal = await app.request('/api/files/bases/..%2F..%2Fsecreto.md', { headers });
  assert.equal(traversal.status, 400);
  await app.request('/api/files/skills/nueva', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: '# Nueva' }),
  });
  assert.equal(existsSync(join(ctx.workspace.root, '.claude/skills/nueva/SKILL.md')), true);
  writeFileSync(join(ctx.config.dataDir, 'secreto.txt'), 'RESERVADO');
  mkdirSync(join(ctx.config.dataDir, 'media'), { recursive: true });
  writeFileSync(join(ctx.config.dataDir, 'media/video.mp4'), '0123456789');
  const partial = await app.request('/media/video.mp4', { headers: { range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await partial.text(), '2345');
  const tail = await app.request('/media/video.mp4', { headers: { range: 'bytes=-3' } });
  assert.equal(await tail.text(), '789');
  assert.equal((await app.request('/media/video.mp4', { headers: { range: 'bytes=20-' } })).status, 416);
  assert.equal((await app.request('/media/video.mp4')).headers.get('accept-ranges'), 'bytes');
  for (const path of ['/media/%2e%2e/secreto.txt', '/media/..%2fsecreto.txt', '/..%2f..%2fsecreto.txt']) {
    assert.doesNotMatch(await (await app.request(path)).text(), /RESERVADO/);
  }
});

test('publicador de instagram: carrusel', async () => {
  const calls: string[] = [];
  let next = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : '';
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]} ${body}`);
    if (url.includes('status_code')) return Response.json({ status_code: 'FINISHED' });
    if (url.includes('permalink')) return Response.json({ permalink: 'https://instagram.com/p/z' });
    next += 1;
    return Response.json({ id: `c${next}` });
  }) as typeof fetch;
  const publish = instagramPublisher({ fetchImpl, sleep: async () => {} });
  const result = await publish(
    { graphUrl: 'https://graph.test', userId: '99', token: 'tok' },
    { format: 'carrusel', caption: 'Hola', mediaUrls: ['https://a/1.jpg', 'https://a/2.jpg'] },
  );
  assert.deepEqual(result, { id: 'c4', permalink: 'https://instagram.com/p/z' });
  const posts = calls.filter((call) => call.startsWith('POST'));
  assert.equal(posts.length, 4);
  assert.match(posts[0], /is_carousel_item=true/);
  assert.match(posts[2], /media_type=CAROUSEL/);
  assert.match(posts[2], /children=c1%2Cc2/);
  assert.match(posts[3], /media_publish creation_id=c3/);
});

test('publicador de instagram: error de la api', async () => {
  const fetchImpl = (async () =>
    Response.json({ error: { message: 'Token inválido' } }, { status: 400 })) as typeof fetch;
  const publish = instagramPublisher({ fetchImpl, sleep: async () => {} });
  await assert.rejects(
    publish(
      { graphUrl: 'https://graph.test', userId: '99', token: 'tok' },
      { format: 'post', caption: 'Hola', mediaUrls: ['https://a/1.jpg'] },
    ),
    /Token inválido/,
  );
});

test('conexión de instagram con unified login', async () => {
  const calls: string[] = [];
  let assigned: unknown[] = [{ id: '178', username: 'heysquai' }];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/oauth/access_token')) return Response.json({ access_token: 'sistema' });
    if (url.includes('/debug_token')) return Response.json({ data: { expires_at: 0 } });
    return Response.json({ data: assigned });
  }) as typeof fetch;
  const { ctx } = setup(async () => proposal, {
    IG_APP_ID: 'app1',
    IG_APP_SECRET: 'sec1',
    IG_CONFIG_ID: 'cfg1',
  });
  const app = createApp(ctx, fetchImpl);
  const session = await login(app);
  assert.equal(instagramReady(ctx), false);

  async function start() {
    const response = await app.request('/api/connections/instagram/start', {
      method: 'POST',
      headers: { cookie: session },
    });
    const { url } = (await response.json()) as { url: string };
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
    return { authorize: new URL(url), headers: { cookie: `${session}; ${cookie}` } };
  }

  const { authorize, headers } = await start();
  assert.equal(authorize.origin + authorize.pathname, 'https://www.facebook.com/v26.0/dialog/oauth');
  assert.equal(authorize.searchParams.get('client_id'), 'app1');
  assert.equal(authorize.searchParams.get('config_id'), 'cfg1');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('scope'), null);
  assert.equal(
    authorize.searchParams.get('redirect_uri'),
    'https://ce.test/api/connections/instagram/callback',
  );
  const state = authorize.searchParams.get('state') as string;

  const forged = await app.request('/api/connections/instagram/callback?code=abc&state=otro', {
    headers,
  });
  assert.match(forged.headers.get('location') ?? '', /conexion=error/);
  assert.equal(calls.length, 0);

  const ok = await app.request(`/api/connections/instagram/callback?code=abc&state=${state}`, {
    headers,
  });
  assert.equal(ok.headers.get('location'), '/?conexion=ok');
  assert.equal(instagramReady(ctx), true);
  assert.deepEqual(savedConnection(ctx), {
    userId: '178',
    username: 'heysquai',
    token: 'sistema',
    expiresAt: null,
  });
  assert.match(calls[0], /^https:\/\/graph\.facebook\.com\/v26\.0\/oauth\/access_token\?/);
  assert.match(calls[0], /client_secret=sec1/);
  assert.match(calls[0], /code=abc/);
  assert.match(calls[1], /debug_token\?input_token=sistema&access_token=app1%7Csec1/);
  assert.match(calls[2], /me\/assigned_instagram_accounts\?fields=id%2Cusername/);
  assert.equal(instagramAccount(ctx).graphUrl, 'https://graph.facebook.com/v26.0');

  await app.request('/api/connections/instagram', { method: 'DELETE', headers: { cookie: session } });
  assert.equal(instagramReady(ctx), false);

  assigned = [];
  const retry = await start();
  const empty = await app.request(
    `/api/connections/instagram/callback?code=abc&state=${retry.authorize.searchParams.get('state')}`,
    { headers: retry.headers },
  );
  assert.match(decodeURIComponent(empty.headers.get('location') ?? ''), /business_management/);
  assert.equal(instagramReady(ctx), false);
});

test('sin app de meta no se puede iniciar la conexión', async () => {
  const { ctx } = setup(async () => proposal);
  const app = createApp(ctx);
  const response = await app.request('/api/connections/instagram/start', {
    method: 'POST',
    headers: { cookie: await login(app) },
  });
  assert.equal(response.status, 400);
});

const planned = {
  title: 'Idea 1',
  message: 'm',
  pillar: 'Anti-humo',
  format: 'post',
  service: 'One',
  funnel: 'TOFU',
  cta: 'Lista de espera',
  scheduled_at: '2026-11-17T12:00:00-05:00',
};

test('el planner reintenta cuando no propone ideas', async () => {
  const prompts: string[] = [];
  const { ctx } = setup(async ({ prompt }) => {
    prompts.push(prompt);
    return prompts.length === 1
      ? { items: [], research: '# Research semanal: Instagram' }
      : { items: [planned], research: '' };
  });
  ctx.store.setSetting('planning', { pieces: 5, slots: [{ weekday: 2, time: '09:30' }] });
  const job = ctx.store.enqueue('plan', 'planner', null);
  await workOnce(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Cantidad: 5 piezas/);
  assert.match(prompts[0], /martes 09:30/);
  assert.match(prompts[0], /items es obligatorio y nunca va vacío/);
  assert.match(prompts[1], /dejó items vacío/);
  assert.match(prompts[1], /# Research semanal: Instagram/);
  assert.equal(ctx.store.listItems().length, 1);
  assert.equal(ctx.store.listJobs().find((entry) => entry.id === job?.id)?.status, 'done');
  assert.match(
    readFileSync(join(ctx.workspace.root, 'bases/research-semanal.md'), 'utf8'),
    /Research semanal: Instagram/,
  );
  const kinds = ctx.store.listJobEvents(job?.id as string).map((event) => event.kind);
  assert.deepEqual(kinds, ['prompt', 'step', 'prompt', 'step']);
});

test('cancelar una ejecución en curso y en cola', async () => {
  let started: () => void = () => {};
  const running = new Promise<void>((done) => {
    started = done;
  });
  const { ctx } = setup(
    ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Ejecución cancelada.')));
        started();
      }),
  );
  const app = createApp(ctx);
  const headers = { cookie: await login(app) };
  const item = ctx.store.createItem({ title: 'x', format: 'carrusel' });
  const job = ctx.store.enqueue('produce', 'productor', item.id);
  const work = workOnce(ctx);
  await running;
  assert.equal(ctx.store.getItem(item.id)?.status, 'produciendo');
  const response = await app.request(`/api/jobs/${job?.id}/cancel`, { method: 'POST', headers });
  assert.equal(response.status, 200);
  await work;
  assert.equal(ctx.store.getJob(job?.id as string)?.status, 'cancelled');
  assert.equal(ctx.store.getItem(item.id)?.status, 'idea');

  const queued = ctx.store.enqueue('plan', 'planner', null);
  cancelJob(ctx, queued?.id as string);
  assert.equal(ctx.store.getJob(queued?.id as string)?.status, 'cancelled');
  assert.equal(await workOnce(ctx), false);
});

test('regenerar una propuesta y reejecutar una ejecución', async () => {
  const { ctx, rendered } = setup(async () => structuredClone(proposal));
  const app = createApp(ctx);
  const headers = { cookie: await login(app) };
  const item = ctx.store.createItem({ title: 'x', format: 'carrusel' });
  ctx.store.enqueue('produce', 'productor', item.id);
  await workOnce(ctx);
  assert.equal(ctx.store.getItem(item.id)?.iteration, 1);
  const stale = join(ctx.config.dataDir, 'media', item.id, 'v1-1.jpg');
  mkdirSync(join(ctx.config.dataDir, 'media', item.id), { recursive: true });
  writeFileSync(stale, 'x');

  const run = await app.request(`/api/items/${item.id}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'produce' }),
  });
  assert.equal(run.status, 200);
  assert.equal(ctx.store.getItem(item.id)?.status, 'produciendo');
  const again = await app.request(`/api/items/${item.id}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'produce' }),
  });
  assert.equal(again.status, 400);
  await workOnce(ctx);
  assert.equal(ctx.store.getItem(item.id)?.iteration, 2);
  assert.equal(ctx.store.getItem(item.id)?.status, 'revision');
  assert.equal(rendered.length, 4);
  assert.equal(existsSync(stale), false);

  const [last] = ctx.store.listJobs();
  const rerun = await app.request(`/api/jobs/${last.id}/rerun`, { method: 'POST', headers });
  assert.equal(rerun.status, 200);
  await workOnce(ctx);
  assert.equal(ctx.store.getItem(item.id)?.iteration, 3);

  const detail = await app.request(`/api/jobs/${last.id}`, { headers });
  const body = (await detail.json()) as { job: { item_title: string }; events: { kind: string }[] };
  assert.equal(body.job.item_title, 'x');
  assert.deepEqual(
    body.events.map((event) => event.kind),
    ['prompt', 'step', 'step'],
  );

  const revise = await app.request(`/api/items/${item.id}/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'revise' }),
  });
  assert.equal(revise.status, 400);
});

test('un reel se produce como video con una escena por lámina', async () => {
  const prompts: string[] = [];
  const scenes = [slide, { ...slide, title: 'Dos' }, { ...slide, title: 'Tres [[clave]]' }];
  const { ctx, videos, rendered } = setup(async ({ prompt }) => {
    prompts.push(prompt);
    return prompts.length === 1
      ? { ...proposal, slides: [], script: 'Guion.' }
      : { ...proposal, template: 'reel-squai.html', slides: scenes, script: 'Guion.' };
  });
  const item = ctx.store.createItem({ title: 'x', format: 'reel', service: 'One' });
  ctx.store.enqueue('produce', 'productor', item.id);
  await workOnce(ctx);
  assert.match(prompts[1], /entre 3 y 9 escenas/);
  const produced = ctx.store.getItem(item.id);
  assert.equal(produced?.status, 'revision');
  assert.deepEqual(produced?.assets, [`${item.id}/v1.mp4`]);
  assert.equal(rendered.length, 0);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].width, 1080);
  assert.equal(videos[0].height, 1920);
  assert.equal(videos[0].scenes.length, 3);
  assert.equal(videos[0].scenes[0].seconds, sceneSeconds(slide));
  assert.match(videos[0].scenes[0].html, /data-service="One"/);
  assert.match(videos[0].scenes[2].html, /Tres <mark>clave<\/mark>/);
});

test('resaltado, anotación, fuente y contexto en la lámina', () => {
  const html = buildSlideHtml(
    '{{title}}|{{body}}|{{note}}|{{source}}|{{service}}|{{seconds}}',
    '',
    { kicker: '', title: 'Una [[frase <clave>]]', body: 'b', note: 'n', source: 'NIST' },
    0,
    1,
    { service: 'Grow"', seconds: '4.5' },
  );
  assert.equal(html, 'Una <mark>frase &lt;clave&gt;</mark>|b|n|NIST|Grow&quot;|4.5');
  assert.equal(sceneSeconds({ kicker: '', title: 'Corto', body: '' }), 2.5);
  assert.equal(sceneSeconds({ kicker: '', title: 'a '.repeat(60), body: '' }), 7);
});

test('eventos del stream de claude', () => {
  const events = agentEvents({
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'pienso' },
        { type: 'text', text: 'Leo las bases.' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'bases/icp.md' } },
      ],
    },
  });
  assert.deepEqual(
    events.map((event) => [event.kind, event.name]),
    [
      ['thinking', ''],
      ['text', ''],
      ['tool', 'Read'],
    ],
  );
  assert.equal(events[2].body, '{"file_path":"bases/icp.md"}');
  const [result] = agentEvents({
    type: 'user',
    message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '# ICP' }], is_error: true }] },
  });
  assert.deepEqual(result, { kind: 'tool_result', name: 'error', body: '# ICP' });
  assert.deepEqual(agentEvents({ type: 'system' }), []);
});

test('la semilla actualiza archivos intactos y respeta los editados', () => {
  const base = mkdtempSync(join(tmpdir(), 'seed-'));
  const seed = join(base, 'seed');
  const root = join(base, 'workspace');
  mkdirSync(join(seed, 'bases'), { recursive: true });
  writeFileSync(join(seed, 'bases/a.md'), 'a1');
  writeFileSync(join(seed, 'bases/b.md'), 'b1');
  assert.deepEqual(syncSeed(root, seed).sort(), ['bases/a.md', 'bases/b.md']);

  writeFileSync(join(root, 'bases/b.md'), 'editado');
  writeFileSync(join(seed, 'bases/a.md'), 'a2');
  writeFileSync(join(seed, 'bases/b.md'), 'b2');
  writeFileSync(join(seed, 'bases/c.md'), 'c1');
  assert.deepEqual(syncSeed(root, seed).sort(), ['bases/a.md', 'bases/c.md']);
  assert.equal(readFileSync(join(root, 'bases/a.md'), 'utf8'), 'a2');
  assert.equal(readFileSync(join(root, 'bases/b.md'), 'utf8'), 'editado');

  rmSync(join(root, 'bases/c.md'));
  assert.deepEqual(syncSeed(root, seed), []);
  assert.equal(existsSync(join(root, 'bases/c.md')), false);

  const legacy = join(base, 'legacy');
  mkdirSync(join(legacy, 'bases'), { recursive: true });
  writeFileSync(join(legacy, 'bases/a.md'), 'a0');
  writeFileSync(join(legacy, 'bases/b.md'), 'mío');
  writeFileSync(
    join(seed, '.seed-history.json'),
    JSON.stringify({ 'bases/a.md': [createHash('sha256').update('a0').digest('hex').slice(0, 16)] }),
  );
  syncSeed(legacy, seed);
  assert.equal(readFileSync(join(legacy, 'bases/a.md'), 'utf8'), 'a2');
  assert.equal(readFileSync(join(legacy, 'bases/b.md'), 'utf8'), 'mío');
  assert.equal(existsSync(join(legacy, '.seed-history.json')), false);
});

test('siguiente horario libre', () => {
  const slots = [
    { weekday: 1, time: '12:00' },
    { weekday: 3, time: '09:30' },
  ];
  const now = new Date('2026-11-16T18:00:00Z');
  assert.equal(nextSlot(slots, [], now, 'America/Bogota'), '2026-11-18T14:30:00.000Z');
  assert.equal(
    nextSlot(slots, ['2026-11-18T14:30:00.000Z'], now, 'America/Bogota'),
    '2026-11-23T17:00:00.000Z',
  );
  assert.equal(nextSlot([], [], now, 'America/Bogota'), null);
});

test('tráfico de salida acumulado por mes', () => {
  const table = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo: 500 5 0 0 0 0 0 0 500 5 0 0 0 0 0 0',
    '  ens3: 9000 9 0 0 0 0 0 0 4000 4 0 0 0 0 0 0',
    '  ens4: 100 1 0 0 0 0 0 0 1000 1 0 0 0 0 0 0',
  ].join('\n');
  assert.equal(transmittedBytes(table), 5000);
  const first = addEgress(null, '2026-11', 5000);
  assert.deepEqual(first, { month: '2026-11', bytes: 0, last: 5000 });
  const second = addEgress(first, '2026-11', 7500);
  assert.equal(second.bytes, 2500);
  assert.equal(addEgress(second, '2026-11', 300).bytes, 2800);
  assert.equal(addEgress(second, '2026-12', 8000).bytes, 500);
});

test('api: vista previa de template, planificación y servidor', async () => {
  const { ctx } = setup(async () => proposal);
  const app = createApp(ctx);
  const headers = { cookie: await login(app) };
  const content = readFileSync(join(ctx.workspace.root, 'templates/carrusel-squai.html'), 'utf8');
  const preview = await app.request('/api/templates/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify({ content, service: 'Learn' }),
  });
  const body = (await preview.json()) as { width: number; formats: string[]; slides: string[] };
  assert.equal(body.width, 1080);
  assert.deepEqual(body.formats, ['carrusel']);
  assert.equal(body.slides.length, 6);
  assert.match(body.slides[0], /data-service="Learn" data-index="1" data-total="6"/);
  assert.match(body.slides[0], /<mark>frase clave<\/mark>/);
  const invalid = await app.request('/api/templates/preview', {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: '<p>{{title}}</p>' }),
  });
  assert.equal(invalid.status, 400);

  const planning = await app.request('/api/planning', {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      pieces: 99,
      slots: [
        { weekday: 5, time: '18:00' },
        { weekday: 9, time: '18:00' },
        { weekday: 1, time: 'tarde' },
        { weekday: 1, time: '08:00' },
      ],
    }),
  });
  assert.deepEqual(await planning.json(), {
    pieces: 21,
    slots: [
      { weekday: 1, time: '08:00' },
      { weekday: 5, time: '18:00' },
    ],
  });

  const server = (await (await app.request('/api/server', { headers })).json()) as {
    limits: { ocpu: number };
    disk: { total: number };
  };
  assert.equal(server.limits.ocpu, 4);
  assert.ok(server.disk.total > 0);
});

test('primer comentario al publicar', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]} ${init?.body ? String(init.body) : ''}`);
    if (url.includes('status_code')) return Response.json({ status_code: 'FINISHED' });
    if (url.includes('/comments')) return Response.json({ error: { message: 'Sin permiso' } }, { status: 400 });
    return Response.json({ id: 'm1', permalink: 'https://instagram.com/p/z' });
  }) as typeof fetch;
  const publish = instagramPublisher({ fetchImpl, sleep: async () => {} });
  const result = await publish(
    { graphUrl: 'https://graph.test', userId: '99', token: 'tok' },
    { format: 'post', caption: 'Hola', mediaUrls: ['https://a/1.jpg'], firstComment: ' #ia ' },
  );
  assert.equal(result.id, 'm1');
  assert.match(result.warning ?? '', /Sin permiso/);
  assert.ok(calls.some((call) => call.startsWith('POST https://graph.test/m1/comments message=%23ia')));
});

test('analítica de instagram tolera la falta de permisos', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/insights')) {
      return url.includes('/2/')
        ? Response.json({ error: { message: 'permiso' } }, { status: 400 })
        : Response.json({ data: [{ name: 'reach', values: [{ value: 320 }] }, { name: 'saved', values: [{ value: 7 }] }] });
    }
    if (url.includes('/media')) {
      return Response.json({
        data: [
          { id: '1', caption: 'Uno', media_type: 'IMAGE', like_count: 10, comments_count: 2, timestamp: '2026-11-10T17:00:00+0000' },
          { id: '2', caption: 'Dos', media_product_type: 'REELS', like_count: 4, comments_count: 0 },
        ],
      });
    }
    return Response.json({ username: 'heysquai', followers_count: 1200, media_count: 2 });
  }) as typeof fetch;
  const insights = await fetchInsights({ graphUrl: 'https://graph.test', userId: '99', token: 'tok' }, fetchImpl);
  assert.equal(insights.followers, 1200);
  assert.equal(insights.media[0].reach, 320);
  assert.equal(insights.media[0].saved, 7);
  assert.equal(insights.media[1].reach, null);
  assert.equal(insights.media[1].type, 'REELS');
  assert.match(insights.warning, /instagram_manage_insights/);
});
