import type { InstagramAccount } from './publisher.ts';

export type MediaInsight = {
  id: string;
  caption: string;
  type: string;
  permalink: string;
  thumbnail: string;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  views: number | null;
};

export type Insights = {
  fetchedAt: number;
  username: string;
  followers: number;
  mediaCount: number;
  media: MediaInsight[];
  warning: string;
};

type Payload = Record<string, unknown>;

const MEDIA_LIMIT = 12;
const METRIC_SETS = ['reach,saved,shares,views', 'reach,saved'];
const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count';

export async function fetchInsights(
  account: InstagramAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<Insights> {
  async function get(path: string, params: Record<string, string>): Promise<Payload> {
    const query = new URLSearchParams({ ...params, access_token: account.token });
    const response = await fetchImpl(`${account.graphUrl}/${path}?${query}`);
    const body = (await response.json().catch(() => ({}))) as Payload;
    if (!response.ok || body.error) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(`Instagram: ${error?.message ?? response.status}`);
    }
    return body;
  }

  async function metrics(id: string): Promise<Record<string, number>> {
    for (const metric of METRIC_SETS) {
      try {
        const body = await get(`${id}/insights`, { metric });
        const entries = (body.data as { name: string; values?: { value: number }[] }[]) ?? [];
        return Object.fromEntries(entries.map((entry) => [entry.name, entry.values?.[0]?.value ?? 0]));
      } catch {}
    }
    throw new Error('sin permiso');
  }

  const profile = await get(account.userId, { fields: 'username,followers_count,media_count' });
  const list = await get(`${account.userId}/media`, {
    fields: MEDIA_FIELDS,
    limit: String(MEDIA_LIMIT),
  });
  let warning = '';
  const media: MediaInsight[] = [];
  for (const entry of (list.data as Payload[] | undefined) ?? []) {
    const extra = await metrics(String(entry.id)).catch(() => {
      warning =
        'Meta no entregó alcance ni guardados. Agrega el permiso instagram_manage_insights a la configuración de inicio de sesión y reconecta.';
      return {} as Record<string, number>;
    });
    media.push({
      id: String(entry.id),
      caption: String(entry.caption ?? ''),
      type: String(entry.media_product_type ?? entry.media_type ?? ''),
      permalink: String(entry.permalink ?? ''),
      thumbnail: String(entry.thumbnail_url ?? entry.media_url ?? ''),
      timestamp: String(entry.timestamp ?? ''),
      likes: Number(entry.like_count ?? 0),
      comments: Number(entry.comments_count ?? 0),
      reach: extra.reach ?? null,
      saved: extra.saved ?? null,
      shares: extra.shares ?? null,
      views: extra.views ?? null,
    });
  }
  return {
    fetchedAt: Date.now(),
    username: String(profile.username ?? ''),
    followers: Number(profile.followers_count ?? 0),
    mediaCount: Number(profile.media_count ?? 0),
    media,
    warning,
  };
}
