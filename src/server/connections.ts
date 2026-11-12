import type { Config } from './config.ts';

export type InstagramConnection = {
  userId: string;
  username: string;
  token: string;
  expiresAt: number | null;
};

export const CONNECTION_KEY = 'instagram';

type Payload = Record<string, unknown>;

export function callbackUrl(config: Config): string {
  return `${config.publicUrl}/api/connections/instagram/callback`;
}

export function appConfigured(config: Config): boolean {
  return Boolean(config.igAppId && config.igAppSecret && config.igConfigId);
}

export function authorizeUrl(config: Config, state: string): string {
  const query = new URLSearchParams({
    client_id: config.igAppId,
    config_id: config.igConfigId,
    redirect_uri: callbackUrl(config),
    response_type: 'code',
    override_default_response_type: 'true',
    state,
  });
  return `${config.igAuthUrl}?${query}`;
}

async function readPayload(response: Response): Promise<Payload> {
  const body = (await response.json().catch(() => ({}))) as Payload;
  if (!response.ok || body.error) {
    const error = body.error as { message?: string } | string | undefined;
    const text = (typeof error === 'string' ? error : error?.message) ?? `HTTP ${response.status}`;
    throw new Error(`Meta: ${text}`);
  }
  return body;
}

export async function completeConnection(
  config: Config,
  rawCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstagramConnection> {
  const graph = config.igGraphUrl;
  const exchange = await readPayload(
    await fetchImpl(
      `${graph}/oauth/access_token?${new URLSearchParams({
        client_id: config.igAppId,
        client_secret: config.igAppSecret,
        redirect_uri: callbackUrl(config),
        code: rawCode.replace(/#_$/, ''),
      })}`,
    ),
  );
  const token = String(exchange.access_token ?? '');
  if (!token) throw new Error('Meta: no entregó un token.');

  const debug = await readPayload(
    await fetchImpl(
      `${graph}/debug_token?${new URLSearchParams({
        input_token: token,
        access_token: `${config.igAppId}|${config.igAppSecret}`,
      })}`,
    ),
  );
  const expiresAt = Number((debug.data as Payload | undefined)?.expires_at ?? 0);

  const accounts = await readPayload(
    await fetchImpl(
      `${graph}/me/assigned_instagram_accounts?${new URLSearchParams({
        fields: 'id,username',
        access_token: token,
      })}`,
    ),
  );
  const [account] = (accounts.data as Payload[] | undefined) ?? [];
  if (!account?.id) {
    throw new Error(
      'Meta no asignó ninguna cuenta de Instagram. Agrega business_management a la configuración de Facebook Login for Business y vuelve a conectar.',
    );
  }
  return {
    userId: String(account.id),
    username: String(account.username ?? ''),
    token,
    expiresAt: expiresAt > 0 ? expiresAt * 1000 : null,
  };
}
