export type Status =
  | 'idea'
  | 'produciendo'
  | 'revision'
  | 'ajustes'
  | 'aprobada'
  | 'publicando'
  | 'publicada'
  | 'error';
export type Format = 'post' | 'carrusel' | 'reel' | 'story';
export type Slide = { kicker: string; title: string; body: string; note?: string; source?: string };
export type ItemEvent = { id: number; at: string; kind: string; detail: string };
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type Job = {
  id: string;
  action: string;
  agent: string;
  item_id: string | null;
  item_title?: string | null;
  status: JobStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type JobEvent = { id: number; at: string; kind: string; name: string; body: string };
export type Item = {
  id: string;
  title: string;
  message: string;
  pillar: string;
  format: Format;
  service: string;
  funnel: string;
  cta: string;
  scheduled_at: string | null;
  status: Status;
  copy: string;
  spec: { template: string; slides: Slide[]; script: string } | null;
  assets: string[];
  notes: string;
  iteration: number;
  permalink: string | null;
  error: string | null;
  first_comment: string;
  footage: string;
  events?: ItemEvent[];
  job?: Job | null;
};
export type Taxonomy = { pillars: string[]; services: string[]; funnel: string[]; ctas: string[] };
export type Slot = { weekday: number; time: string };
export type Planning = { pieces: number; slots: Slot[] };
export type AppStatus = {
  instagram: boolean;
  timezone: string;
  taxonomy: Taxonomy;
  planning: Planning;
  paused: string;
};
export type Hook = {
  id: string;
  name: string;
  trigger: 'status' | 'weekly';
  status: Status | null;
  weekday: number | null;
  time: string | null;
  action: string;
  agent: string;
  enabled: boolean;
  last_fired: string | null;
};
export type Engine = 'nativo' | 'hyperframes';
export type TemplatePreview = {
  width: number;
  height: number;
  formats: string[];
  engine: Engine;
  footage: boolean;
  duration?: number;
  slides: string[];
};
export type Notice = { id: number; text: string; busy?: boolean; error?: boolean; video?: string };
export type Sample = { at: number; cpu: number; memory: number };
export type ServerSnapshot = {
  limits: { ocpu: number; memoryGb: number; storageGb: number; egressTb: number };
  cpu: { used: number; cores: number; load: number };
  memory: { used: number; total: number };
  disk: { total: number; used: number; media: number; workspace: number; database: number };
  egress: { month: string; bytes: number };
  uptime: number;
  jobsToday: number;
  warnings: string[];
  history: Sample[];
};
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
export type InstagramConnection = {
  configured: boolean;
  redirectUri: string;
  connected: boolean;
  username: string | null;
  expiresAt: number | null;
};

export const STATUS_LABEL: Record<Status, string> = {
  idea: 'Idea',
  produciendo: 'Produciendo',
  revision: 'En revisión',
  ajustes: 'Ajustes',
  aprobada: 'Programada',
  publicando: 'Publicando',
  publicada: 'Publicada',
  error: 'Error',
};
export const FORMAT_LABEL: Record<Format, string> = {
  post: 'Post',
  carrusel: 'Carrusel',
  reel: 'Reel',
  story: 'Story',
};
export const JOB_LABEL: Record<JobStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  done: 'Hecho',
  failed: 'Falló',
  cancelled: 'Cancelada',
};
export const ACTION_LABEL: Record<string, string> = {
  plan: 'Planear semana',
  produce: 'Producir propuesta',
  revise: 'Aplicar ajustes',
};
export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export class Unauthorized extends Error {}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401) throw new Unauthorized(data.error ?? 'No autorizado.');
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

export async function upload(itemId: string, file: File): Promise<Item> {
  const response = await fetch(
    `/api/items/${itemId}/assets?name=${encodeURIComponent(file.name)}`,
    { method: 'POST', body: file },
  );
  const data = (await response.json()) as Item & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

export async function uploadFootage(itemId: string, file: File): Promise<Item> {
  const response = await fetch(
    `/api/items/${itemId}/footage?name=${encodeURIComponent(file.name)}`,
    { method: 'POST', body: file },
  );
  const data = (await response.json()) as Item & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

export function isVideo(asset: string): boolean {
  return /\.(mp4|mov)$/i.test(asset);
}

export function isBusy(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}
