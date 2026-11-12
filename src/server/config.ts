import { resolve } from 'node:path';

export type Config = {
  port: number;
  host: string;
  publicUrl: string;
  adminPassword: string;
  sessionSecret: string;
  timezone: string;
  dataDir: string;
  seedDir: string;
  webDir: string;
  claudeBin: string;
  chromiumPath: string | undefined;
  ffmpegPath: string;
  headlessShellPath: string | undefined;
  transcribeModel: string;
  transcribeLanguage: string;
  igUserId: string;
  igAccessToken: string;
  igGraphUrl: string;
  igAppId: string;
  igAppSecret: string;
  igConfigId: string;
  igAuthUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  const adminPassword = env.ADMIN_PASSWORD ?? '';
  const sessionSecret = env.SESSION_SECRET ?? '';
  const graphVersion = env.IG_GRAPH_VERSION ?? 'v26.0';
  if (!adminPassword || !sessionSecret) {
    throw new Error('ADMIN_PASSWORD y SESSION_SECRET son obligatorios.');
  }
  return {
    port,
    host: env.HOST ?? '127.0.0.1',
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    adminPassword,
    sessionSecret,
    timezone: env.TIMEZONE ?? 'America/Bogota',
    dataDir: resolve(env.DATA_DIR ?? 'data'),
    seedDir: resolve('seed'),
    webDir: resolve('dist/web'),
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    chromiumPath: env.CHROMIUM_PATH || undefined,
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    headlessShellPath: env.HEADLESS_SHELL_PATH || undefined,
    transcribeModel: env.TRANSCRIBE_MODEL || 'small',
    transcribeLanguage: env.TRANSCRIBE_LANGUAGE || 'es',
    igUserId: env.IG_USER_ID ?? '',
    igAccessToken: env.IG_ACCESS_TOKEN ?? '',
    igGraphUrl: (env.IG_GRAPH_URL ?? `https://graph.facebook.com/${graphVersion}`).replace(/\/$/, ''),
    igAppId: env.IG_APP_ID ?? '',
    igAppSecret: env.IG_APP_SECRET ?? '',
    igConfigId: env.IG_CONFIG_ID ?? '',
    igAuthUrl: env.IG_AUTH_URL ?? `https://www.facebook.com/${graphVersion}/dialog/oauth`,
  };
}
