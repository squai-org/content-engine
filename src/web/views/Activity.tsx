import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACTION_LABEL, api, isBusy, type Job, JOB_LABEL, type JobEvent } from '../api.ts';
import { Icon, Markdown, useAutoScroll } from '../ui.tsx';

type Props = {
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOpenItem: (id: string) => void;
  onChanged: () => void;
};

type Turn =
  | { kind: 'prompt' | 'text' | 'thinking' | 'step' | 'error'; event: JobEvent }
  | { kind: 'tool'; event: JobEvent; result: JobEvent | null };

const TOOL: Record<string, { icon: string; verb: string; field: string }> = {
  Read: { icon: 'doc', verb: 'Leyó', field: 'file_path' },
  Glob: { icon: 'search', verb: 'Buscó archivos', field: 'pattern' },
  Grep: { icon: 'search', verb: 'Buscó en los archivos', field: 'pattern' },
  WebSearch: { icon: 'globe', verb: 'Buscó en la web', field: 'query' },
  WebFetch: { icon: 'globe', verb: 'Abrió', field: 'url' },
  Skill: { icon: 'sparkle', verb: 'Usó la skill', field: 'skill' },
};

function clock(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function turns(events: JobEvent[]): Turn[] {
  const list: Turn[] = [];
  for (const event of events) {
    if (event.kind === 'tool') list.push({ kind: 'tool', event, result: null });
    else if (event.kind === 'tool_result') {
      const open = list.findLast((turn) => turn.kind === 'tool' && turn.result === null);
      if (open?.kind === 'tool') open.result = event;
    } else list.push({ kind: event.kind as 'text', event });
  }
  return list;
}

function toolLine(event: JobEvent): { icon: string; text: string } {
  const spec = TOOL[event.name];
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(event.body) as Record<string, unknown>;
  } catch {}
  const value = String(input[spec?.field ?? ''] ?? '').replace(/^.*\/workspace\//, '');
  return { icon: spec?.icon ?? 'bolt', text: `${spec?.verb ?? event.name} ${value}`.trim() };
}

function asJson(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?\n?|\n?```$/g, '');
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function Message({ turn }: { turn: Turn }) {
  const { event } = turn;
  if (turn.kind === 'prompt') {
    return (
      <div className="msg user">
        <details>
          <summary>
            <b>Encargo para {event.name}</b>
            <span>{event.body.split('\n')[0]}</span>
          </summary>
          <pre>{event.body}</pre>
        </details>
      </div>
    );
  }
  if (turn.kind === 'tool') {
    const line = toolLine(event);
    const failed = turn.result?.name === 'error';
    return (
      <details className={`msg tool${failed ? ' failed' : ''}`}>
        <summary>
          <Icon name={line.icon} size={14} />
          <span>{line.text}</span>
          {!turn.result && <span className="typing small"><i /><i /><i /></span>}
        </summary>
        {turn.result && <pre>{turn.result.body || 'Sin contenido.'}</pre>}
      </details>
    );
  }
  if (turn.kind === 'thinking') {
    return (
      <details className="msg thinking">
        <summary>Razonamiento</summary>
        <p>{event.body}</p>
      </details>
    );
  }
  if (turn.kind === 'step') {
    return (
      <div className="msg step">
        <b>{event.name}</b>
        {event.body && <span>{event.body}</span>}
      </div>
    );
  }
  if (turn.kind === 'error') {
    return (
      <div className="msg failure">
        <b>{event.name}</b>
        <span>{event.body}</span>
      </div>
    );
  }
  const json = asJson(event.body);
  return (
    <div className="msg assistant">
      {json ? (
        <details>
          <summary>
            <b>Respuesta del agente</b>
          </summary>
          <pre>{json}</pre>
        </details>
      ) : (
        <Markdown source={event.body} />
      )}
    </div>
  );
}

export function Activity({ selected, onSelect, onOpenItem, onChanged }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    setJobs(await api<Job[]>('/jobs'));
  }, []);

  useEffect(() => {
    loadJobs();
    const timer = setInterval(loadJobs, 4000);
    return () => clearInterval(timer);
  }, [loadJobs]);

  useEffect(() => {
    if (!selected && jobs[0]) onSelect(jobs[0].id);
  }, [selected, jobs, onSelect]);

  useEffect(() => {
    setJob(null);
    setEvents([]);
    setError('');
    if (!selected) return;
    let live = true;
    let last = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await api<{ job: Job; events: JobEvent[] }>(`/jobs/${selected}?after=${last}`);
        if (!live) return;
        setJob(data.job);
        if (data.events.length) {
          last = data.events[data.events.length - 1].id;
          setEvents((current) => [...current, ...data.events]);
        }
        timer = setTimeout(poll, isBusy(data.job.status) ? 1500 : 6000);
      } catch (failure) {
        if (live) setError((failure as Error).message);
      }
    }
    poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [selected]);

  const list = useMemo(() => turns(events), [events]);
  const scroll = useAutoScroll(list.length);

  async function act(path: string) {
    setError('');
    try {
      const result = await api<Job>(`/jobs/${selected}/${path}`, 'POST');
      await loadJobs();
      onChanged();
      if (path === 'rerun') onSelect(result.id);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const busy = job ? isBusy(job.status) : false;

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Actividad</h1>
        <div className="spacer" />
        {error && <span className="error-text">{error}</span>}
        {job?.item_id && job.item_title && (
          <button type="button" onClick={() => onOpenItem(job.item_id as string)}>
            <Icon name="eye" size={14} />
            Ver pieza
          </button>
        )}
        {job && busy && (
          <button type="button" className="destructive" onClick={() => act('cancel')}>
            <Icon name="stop" size={12} />
            Cancelar
          </button>
        )}
        {job && !busy && (
          <button type="button" className="primary" onClick={() => act('rerun')}>
            <Icon name="refresh" size={14} />
            Reejecutar
          </button>
        )}
      </header>
      <div className="split wide-list">
        <div className="file-list">
          {jobs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`run-item${entry.id === selected ? ' active' : ''}`}
              onClick={() => onSelect(entry.id)}
            >
              <span className={`run-dot j-${entry.status}`} />
              <span className="list-main">
                <b>{entry.item_title ?? ACTION_LABEL[entry.action]}</b>
                <span className="muted">
                  {entry.item_title ? `${ACTION_LABEL[entry.action]} · ` : ''}
                  {entry.agent} · {clock(entry.created_at)}
                </span>
              </span>
              <span className={`pill j-${entry.status}`}>{JOB_LABEL[entry.status]}</span>
            </button>
          ))}
          {!jobs.length && <p className="empty">Sin ejecuciones.</p>}
        </div>
        <div className="chat" ref={scroll.ref} onScroll={scroll.onScroll}>
          {job && (
            <div className="chat-inner">
              <div className="chat-head">
                <span className="avatar">
                  <Icon name="agent" size={18} />
                </span>
                <div>
                  <b>{job.agent}</b>
                  <span className="muted">
                    {ACTION_LABEL[job.action]}
                    {job.item_title ? ` · ${job.item_title}` : ''} · intento {Math.max(1, job.attempts)}
                  </span>
                </div>
              </div>
              {list.map((turn) => (
                <Message key={turn.event.id} turn={turn} />
              ))}
              {job.status === 'running' && (
                <div className="msg assistant">
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}
              {job.status === 'queued' && (
                <div className="msg step">
                  <b>En cola</b>
                  <span>
                    {job.error
                      ? `El intento anterior falló: ${job.error}`
                      : 'Empieza cuando termine la ejecución anterior.'}
                  </span>
                </div>
              )}
              {!list.length && !busy && (
                <p className="empty">Esta ejecución es anterior al registro de conversaciones.</p>
              )}
            </div>
          )}
          {!job && <p className="empty">Elige una ejecución.</p>}
        </div>
      </div>
    </section>
  );
}
