import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { claudeExecutor, type Context } from './agents.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createStore } from './db.ts';
import { startPipeline } from './pipeline.ts';
import { instagramPublisher } from './publisher.ts';
import { videoComposer } from './engines.ts';
import { createMonitor } from './monitor.ts';
import { chromiumRenderer, chromiumVideoRenderer } from './render.ts';
import { createWorkspace } from './workspace.ts';

const config = loadConfig();
mkdirSync(join(config.dataDir, 'media'), { recursive: true });

const store = createStore(join(config.dataDir, 'content.db'));
const workspace = createWorkspace(join(config.dataDir, 'workspace'), config.seedDir);
const ctx: Context = {
  config,
  store,
  workspace,
  executor: claudeExecutor(config.claudeBin),
  renderer: chromiumRenderer(config.chromiumPath),
  video: chromiumVideoRenderer(config.chromiumPath, config.ffmpegPath),
  compose: videoComposer(config, workspace.tokens),
  publish: instagramPublisher(),
  monitor: createMonitor(config, store),
};

startPipeline(ctx, () => Boolean(ctx.monitor.pausedReason()));
serve({ fetch: createApp(ctx).fetch, port: config.port, hostname: config.host });
console.log(`content-engine en ${config.publicUrl}`);
