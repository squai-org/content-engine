import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  FORMAT_LABEL,
  type Format,
  isBusy,
  isVideo,
  type Item,
  STATUS_LABEL,
  type Status,
  type Taxonomy,
  upload,
} from '../api.ts';
import type { Draft } from '../App.tsx';
import { Icon, Modal } from '../ui.tsx';

type Props = {
  itemId: string | null;
  draft: Draft | null;
  taxonomy: Taxonomy;
  onClose: () => void;
  onChanged: () => void;
  onCreated: (id: string) => void;
  onShowJob: (id: string) => void;
};

type Fields = {
  title: string;
  message: string;
  pillar: string;
  format: Format;
  service: string;
  funnel: string;
  cta: string;
  scheduled_at: string;
  copy: string;
  notes: string;
  first_comment: string;
};

const FORMATS: Format[] = ['post', 'carrusel', 'reel', 'story'];
const BUSY: Status[] = ['produciendo', 'ajustes', 'publicando'];

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function fieldsOf(item: Item | null, draft: Draft | null): Fields {
  return {
    title: item?.title ?? '',
    message: item?.message ?? '',
    pillar: item?.pillar ?? '',
    format: item?.format ?? 'post',
    service: item?.service ?? '',
    funnel: item?.funnel ?? '',
    cta: item?.cta ?? '',
    scheduled_at: toLocalInput(item?.scheduled_at ?? draft?.scheduled_at ?? null),
    copy: item?.copy ?? '',
    notes: item?.notes ?? '',
    first_comment: item?.first_comment ?? '',
  };
}

export function ItemModal({
  itemId,
  draft,
  taxonomy,
  onClose,
  onChanged,
  onCreated,
  onShowJob,
}: Props) {
  const [item, setItem] = useState<Item | null>(null);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(null, draft));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    if (!itemId) return;
    const loaded = await api<Item>(`/items/${itemId}`);
    setItem(loaded);
    if (!dirtyRef.current) setFields(fieldsOf(loaded, null));
  }, [itemId]);

  useEffect(() => {
    load().catch((failure) => setError((failure as Error).message));
    const timer = setInterval(() => load().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [load]);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      setDirty(false);
      dirtyRef.current = false;
      await load();
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const payload = () => ({ ...fields, scheduled_at: fromLocalInput(fields.scheduled_at) });

  async function create() {
    setError('');
    try {
      const created = await api<Item>('/items', 'POST', payload());
      onCreated(created.id);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const save = (status?: Status) =>
    run(() => api(`/items/${itemId}`, 'PATCH', status ? { ...payload(), status } : payload()));

  const produce = () =>
    run(async () => {
      if (dirty) await api(`/items/${itemId}`, 'PATCH', payload());
      await api(`/items/${itemId}/run`, 'POST', { action: 'produce' });
    });

  const publishNow = () => {
    if (!window.confirm('¿Publicar esta pieza ahora en Instagram?')) return;
    run(() =>
      api(`/items/${itemId}`, 'PATCH', {
        ...payload(),
        scheduled_at: new Date().toISOString(),
        status: 'aprobada',
      }),
    );
  };

  async function nextSlot() {
    setError('');
    try {
      const query = itemId ? `?except=${itemId}` : '';
      const { at } = await api<{ at: string | null }>(`/slots/next${query}`);
      if (at) set('scheduled_at', toLocalInput(at));
      else setError('No hay horarios definidos. Agrégalos en Automatización.');
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  async function remove() {
    if (!window.confirm('¿Eliminar esta pieza?')) return;
    await api(`/items/${itemId}`, 'DELETE');
    onChanged();
    onClose();
  }

  const status = item?.status;
  const locked = status ? BUSY.includes(status) || status === 'publicada' : false;
  const activeJob = item?.job && isBusy(item.job.status) ? item.job : null;
  const produced = item !== null && item.iteration > 0;
  const options = (id: string, values: string[]) => (
    <datalist id={id}>
      {values.map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  );

  return (
    <Modal onClose={onClose} wide={produced}>
      <header className="sheet-head">
        {status ? (
          <span className={`pill s-${status}`}>{STATUS_LABEL[status]}</span>
        ) : (
          <span className="pill">Nueva idea</span>
        )}
        {produced && <span className="muted">Versión {item.iteration}</span>}
        <div className="spacer" />
        {item?.job && (
          <button type="button" className="plain" onClick={() => onShowJob(item.job?.id as string)}>
            <Icon name="activity" size={14} />
            Ver ejecución
          </button>
        )}
        <button type="button" className="round" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className={`sheet-body${produced ? ' columns' : ''}`}>
        {produced && (
          <div className="sheet-media">
            {item.assets.length > 0 ? (
              <div className="assets">
                {item.assets.map((asset) =>
                  isVideo(asset) ? (
                    <video key={asset} src={`/media/${asset}`} controls playsInline />
                  ) : (
                    <a key={asset} href={`/media/${asset}`} target="_blank" rel="noreferrer">
                      <img src={`/media/${asset}`} alt="" />
                    </a>
                  ),
                )}
              </div>
            ) : (
              <p className="empty">Esta pieza aún no tiene archivo.</p>
            )}
            {item.assets.length > 1 && (
              <p className="muted note">{item.assets.length} láminas. Desliza para verlas.</p>
            )}
            {item.spec?.script && (
              <div className="field">
                <span>Guion</span>
                <pre className="script">{item.spec.script}</pre>
              </div>
            )}
            {(status === 'revision' || status === 'error' || status === 'aprobada') && (
              <div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".jpg,.jpeg,.mp4,.mov"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) run(() => upload(item.id, file));
                  }}
                />
                <button type="button" onClick={() => fileInput.current?.click()}>
                  <Icon name="upload" size={14} />
                  {item.format === 'reel' ? 'Subir video propio' : 'Reemplazar con archivo propio'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="sheet-form">
          {item?.error && <p className="banner error">{item.error}</p>}
          {error && <p className="banner error">{error}</p>}
          {status && BUSY.includes(status) && (
            <p className="banner working">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
              El agente está trabajando en esta pieza.
              <span className="spacer" />
              {activeJob && (
                <button
                  type="button"
                  className="destructive"
                  onClick={() => run(() => api(`/jobs/${activeJob.id}/cancel`, 'POST'))}
                >
                  <Icon name="stop" size={12} />
                  Cancelar
                </button>
              )}
            </p>
          )}

          <label className="field">
            <span>Idea</span>
            <input
              className="big"
              value={fields.title}
              disabled={locked}
              placeholder="De qué trata la pieza"
              onChange={(event) => set('title', event.target.value)}
            />
          </label>
          <label className="field">
            <span>Mensaje a transmitir</span>
            <textarea
              rows={2}
              value={fields.message}
              disabled={locked}
              onChange={(event) => set('message', event.target.value)}
            />
          </label>

          <div className="group">
            <label className="row">
              <span>Formato</span>
              <select
                value={fields.format}
                disabled={locked || produced}
                onChange={(event) => set('format', event.target.value as Format)}
              >
                {FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {FORMAT_LABEL[format]}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <span>Fecha</span>
              <input
                type="datetime-local"
                value={fields.scheduled_at}
                disabled={locked}
                onChange={(event) => set('scheduled_at', event.target.value)}
              />
              {!locked && (
                <button type="button" className="plain" onClick={nextSlot} title="Usar el siguiente horario libre">
                  <Icon name="clock" size={14} />
                  Siguiente libre
                </button>
              )}
            </div>
            {(
              [
                ['pillar', 'Pilar', 'pillars'],
                ['service', 'Servicio', 'services'],
                ['funnel', 'Etapa', 'funnel'],
                ['cta', 'CTA', 'ctas'],
              ] as const
            ).map(([key, label, list]) => (
              <label key={key} className="row">
                <span>{label}</span>
                <input
                  list={list}
                  value={fields[key]}
                  disabled={locked}
                  placeholder="Elegir"
                  onChange={(event) => set(key, event.target.value)}
                />
              </label>
            ))}
          </div>
          {options('pillars', taxonomy.pillars)}
          {options('services', taxonomy.services)}
          {options('funnel', taxonomy.funnel)}
          {options('ctas', taxonomy.ctas)}

          {produced && (
            <label className="field">
              <span>Copy</span>
              <textarea
                rows={8}
                value={fields.copy}
                disabled={locked}
                onChange={(event) => set('copy', event.target.value)}
              />
              <small className="muted">{fields.copy.length} / 2200</small>
            </label>
          )}

          {produced && item.format !== 'story' && (
            <label className="field">
              <span>Primer comentario</span>
              <textarea
                rows={2}
                placeholder="Opcional. Se publica como comentario al salir la pieza, por ejemplo los hashtags."
                value={fields.first_comment}
                disabled={locked}
                onChange={(event) => set('first_comment', event.target.value)}
              />
            </label>
          )}

          {status === 'revision' && (
            <label className="field">
              <span>Anotaciones para el agente</span>
              <textarea
                rows={3}
                placeholder="Qué debe cambiar"
                value={fields.notes}
                onChange={(event) => set('notes', event.target.value)}
              />
            </label>
          )}

          {item?.permalink && (
            <a className="link" href={item.permalink} target="_blank" rel="noreferrer">
              Ver en Instagram
            </a>
          )}

          {item?.events && item.events.length > 0 && (
            <details className="field">
              <summary>Historial</summary>
              <ul className="history">
                {item.events.map((event) => (
                  <li key={event.id}>
                    <time>
                      {new Date(event.at).toLocaleString('es', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <b>{event.kind}</b>
                    <span>{event.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      <footer className="sheet-foot">
        {!item && !itemId && (
          <>
            <div className="spacer" />
            <button type="button" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={create}>
              Crear idea
            </button>
          </>
        )}
        {item && (
          <>
            <button type="button" className="destructive" onClick={remove}>
              <Icon name="trash" size={14} />
              Eliminar
            </button>
            <div className="spacer" />
            {!locked && dirty && (
              <button type="button" onClick={() => save()}>
                Guardar
              </button>
            )}
            {status === 'idea' && (
              <button type="button" className="primary" onClick={produce}>
                <Icon name="sparkle" size={14} />
                Producir
              </button>
            )}
            {status === 'revision' && (
              <>
                <button type="button" onClick={produce} title="El agente crea la propuesta otra vez desde cero">
                  <Icon name="refresh" size={14} />
                  Regenerar
                </button>
                <button type="button" onClick={() => save('ajustes')}>
                  Pedir ajustes
                </button>
                <button type="button" onClick={publishNow}>
                  <Icon name="send" size={14} />
                  Publicar ahora
                </button>
                <button type="button" className="primary" onClick={() => save('aprobada')}>
                  Aprobar
                </button>
              </>
            )}
            {status === 'aprobada' && (
              <button type="button" onClick={() => save('revision')}>
                Volver a revisión
              </button>
            )}
            {status === 'error' && (
              <>
                <button type="button" onClick={produce}>
                  <Icon name="refresh" size={14} />
                  Producir de nuevo
                </button>
                {produced && (
                  <button type="button" className="primary" onClick={() => save('revision')}>
                    Volver a revisión
                  </button>
                )}
              </>
            )}
          </>
        )}
      </footer>
    </Modal>
  );
}
