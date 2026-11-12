import { useCallback, useEffect, useState } from 'react';
import { api, type Insights, type MediaInsight } from '../api.ts';
import { Icon } from '../ui.tsx';

type Props = { connected: boolean };

const number = new Intl.NumberFormat('es');
const HOUR_BLOCKS = ['Madrugada', 'Mañana', 'Tarde', 'Noche'];
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function interactions(media: MediaInsight): number {
  return media.likes + media.comments + (media.saved ?? 0) + (media.shares ?? 0);
}

function bestMoment(media: MediaInsight[]): string {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const entry of media) {
    const date = new Date(entry.timestamp);
    const key = `${DAYS[date.getDay()]} · ${HOUR_BLOCKS[Math.floor(date.getHours() / 6)]}`;
    const current = totals.get(key) ?? { sum: 0, count: 0 };
    totals.set(key, { sum: current.sum + interactions(entry), count: current.count + 1 });
  }
  const [best] = [...totals.entries()].sort((a, b) => b[1].sum / b[1].count - a[1].sum / a[1].count);
  return best ? best[0] : 'Sin datos';
}

export function Analytics({ connected }: Props) {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError('');
    try {
      setData(await api<Insights>(`/insights${refresh ? '?refresh=1' : ''}`));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) load(false);
  }, [connected, load]);

  const media = data?.media ?? [];
  const reach = media.reduce((sum, entry) => sum + (entry.reach ?? 0), 0);
  const total = media.reduce((sum, entry) => sum + interactions(entry), 0);
  const ranked = [...media].sort((a, b) => interactions(b) - interactions(a));
  const top = Math.max(1, ...ranked.map(interactions));

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Analítica</h1>
        <div className="spacer" />
        {data && (
          <span className="muted">
            Actualizado {new Date(data.fetchedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button type="button" disabled={!connected || loading} onClick={() => load(true)}>
          <Icon name="refresh" size={14} />
          Actualizar
        </button>
      </header>
      <div className="scroll">
        {!connected && <p className="empty">Conecta Instagram en Conexiones para ver cómo rinden las publicaciones.</p>}
        {error && <p className="banner error">{error}</p>}
        {data?.warning && <p className="banner">{data.warning}</p>}
        {loading && !data && <p className="empty">Consultando Instagram…</p>}
        {data && (
          <>
            <div className="tiles">
              <div className="tile" style={{ '--tone': 'var(--pink)' } as React.CSSProperties}>
                <Icon name="users" size={18} />
                <b>{number.format(data.followers)}</b>
                <span>Seguidores de @{data.username}</span>
              </div>
              <div className="tile" style={{ '--tone': 'var(--blue)' } as React.CSSProperties}>
                <Icon name="eye" size={18} />
                <b>{number.format(reach)}</b>
                <span>Alcance, últimas {media.length} publicaciones</span>
              </div>
              <div className="tile" style={{ '--tone': 'var(--red)' } as React.CSSProperties}>
                <Icon name="heart" size={18} />
                <b>{number.format(total)}</b>
                <span>Interacciones</span>
              </div>
              <div className="tile" style={{ '--tone': 'var(--green)' } as React.CSSProperties}>
                <Icon name="clock" size={18} />
                <b>{bestMoment(media)}</b>
                <span>Mejor momento hasta ahora</span>
              </div>
            </div>
            <div className="list-section">
              <h2>Publicaciones por interacciones</h2>
              <div className="list">
                {ranked.map((entry) => (
                  <a key={entry.id} className="list-row" href={entry.permalink} target="_blank" rel="noreferrer">
                    {entry.thumbnail ? (
                      <img className="thumb" src={entry.thumbnail} alt="" loading="lazy" />
                    ) : (
                      <span className="thumb blank" />
                    )}
                    <span className="list-main">
                      <b>{entry.caption.split('\n')[0] || 'Sin texto'}</b>
                      <span className="muted">
                        {new Date(entry.timestamp).toLocaleDateString('es', { day: 'numeric', month: 'short' })} ·{' '}
                        {entry.likes} me gusta · {entry.comments} comentarios
                        {entry.saved !== null && ` · ${entry.saved} guardados`}
                        {entry.shares !== null && ` · ${entry.shares} compartidos`}
                        {entry.reach !== null && ` · alcance ${number.format(entry.reach)}`}
                      </span>
                      <span className="meter">
                        <i style={{ width: `${(interactions(entry) / top) * 100}%` }} />
                      </span>
                    </span>
                    <b className="score">{number.format(interactions(entry))}</b>
                  </a>
                ))}
                {!ranked.length && <p className="empty">La cuenta aún no tiene publicaciones.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
