import { FORMAT_LABEL, type Item, STATUS_LABEL, type Status } from '../api.ts';
import { Thumb } from '../ui.tsx';

type Props = { items: Item[]; onOpen: (id: string) => void };

const SECTIONS: { title: string; statuses: Status[] }[] = [
  { title: 'Esperan tu revisión', statuses: ['revision'] },
  { title: 'Con error', statuses: ['error'] },
  { title: 'En proceso', statuses: ['idea', 'produciendo', 'ajustes', 'publicando'] },
  { title: 'Programadas', statuses: ['aprobada'] },
];

function when(iso: string | null): string {
  if (!iso) return 'Sin fecha';
  return new Date(iso).toLocaleString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Review({ items, onOpen }: Props) {
  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Revisión</h1>
      </header>
      <div className="scroll">
        {SECTIONS.map((section) => {
          const rows = items.filter((item) => section.statuses.includes(item.status));
          if (!rows.length) return null;
          return (
            <div key={section.title} className="list-section">
              <h2>
                {section.title} <span className="count">{rows.length}</span>
              </h2>
              <div className="cards">
                {rows.map((item) => (
                  <button key={item.id} type="button" className="card" onClick={() => onOpen(item.id)}>
                    <Thumb item={item} className="card-media" />
                    <span className="card-body">
                      <span className={`pill s-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                      <b>{item.title}</b>
                      <span className="muted">
                        {FORMAT_LABEL[item.format]} · {item.pillar || 'Sin pilar'}
                      </span>
                      <span className="muted">{when(item.scheduled_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!items.length && <p className="empty">Aún no hay piezas.</p>}
      </div>
    </section>
  );
}
