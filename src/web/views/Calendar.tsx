import { type DragEvent, useMemo, useState } from 'react';
import { api, FORMAT_LABEL, type Item, STATUS_LABEL } from '../api.ts';
import { Icon, Segmented, Thumb } from '../ui.tsx';

type Mode = 'mes' | 'semana';
type Props = {
  items: Item[];
  onOpen: (id: string) => void;
  onCreate: (scheduledAt: string | null) => void;
  onChanged: () => void;
};

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DEFAULT_HOUR = 12;

function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

export function Calendar({ items, onOpen, onCreate, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('mes');
  const [cursor, setCursor] = useState(() => new Date());
  const [target, setTarget] = useState<string | null>(null);
  const today = dayKey(new Date());

  const days = useMemo(() => {
    if (mode === 'semana') {
      const start = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = startOfWeek(first);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const weeks = Math.ceil((Math.round((last.getTime() - start.getTime()) / 86400000) + 1) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
  }, [mode, cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items) {
      if (!item.scheduled_at) continue;
      const key = dayKey(new Date(item.scheduled_at));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [items]);

  const unscheduled = items.filter((item) => !item.scheduled_at);

  function move(step: number) {
    const next = new Date(cursor);
    if (mode === 'mes') next.setMonth(next.getMonth() + step, 1);
    else next.setDate(next.getDate() + step * 7);
    setCursor(next);
  }

  async function drop(event: DragEvent, day: Date) {
    event.preventDefault();
    setTarget(null);
    const item = items.find((entry) => entry.id === event.dataTransfer.getData('text/plain'));
    if (!item || item.status === 'publicada' || item.status === 'publicando') return;
    const previous = item.scheduled_at ? new Date(item.scheduled_at) : null;
    const next = new Date(day);
    next.setHours(previous?.getHours() ?? DEFAULT_HOUR, previous?.getMinutes() ?? 0, 0, 0);
    await api(`/items/${item.id}`, 'PATCH', { scheduled_at: next.toISOString() });
    onChanged();
  }

  function createOn(day: Date) {
    const date = new Date(day);
    date.setHours(DEFAULT_HOUR, 0, 0, 0);
    onCreate(date.toISOString());
  }

  const title =
    mode === 'mes'
      ? cursor.toLocaleDateString('es', { month: 'long', year: 'numeric' })
      : `${days[0].toLocaleDateString('es', { day: 'numeric', month: 'short' })} – ${days[6].toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">{title}</h1>
        <div className="spacer" />
        <Segmented
          value={mode}
          options={[
            { value: 'mes', label: 'Mes' },
            { value: 'semana', label: 'Semana' },
          ]}
          onChange={setMode}
        />
        <div className="segmented">
          <button type="button" onClick={() => move(-1)} aria-label="Anterior">
            <Icon name="left" size={14} />
          </button>
          <button type="button" onClick={() => setCursor(new Date())}>
            Hoy
          </button>
          <button type="button" onClick={() => move(1)} aria-label="Siguiente">
            <Icon name="right" size={14} />
          </button>
        </div>
        <button type="button" className="primary" onClick={() => onCreate(null)}>
          <Icon name="plus" size={14} />
          Nueva idea
        </button>
      </header>
      {unscheduled.length > 0 && (
        <div className="tray">
          <span className="tray-label">Sin fecha</span>
          {unscheduled.map((item) => (
            <Chip key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
      <div className="weekdays">
        {WEEKDAYS.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>
      <div className={`grid ${mode}`}>
        {days.map((day) => {
          const key = dayKey(day);
          const outside = mode === 'mes' && day.getMonth() !== cursor.getMonth();
          return (
            <div
              key={key}
              className={`day${outside ? ' outside' : ''}${target === key ? ' target' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setTarget(key);
              }}
              onDragLeave={() => setTarget((current) => (current === key ? null : current))}
              onDrop={(event) => drop(event, day)}
              onDoubleClick={() => createOn(day)}
            >
              <div className={`day-number${key === today ? ' today' : ''}`}>{day.getDate()}</div>
              {(byDay.get(key) ?? []).map((item) => (
                <Chip
                  key={item.id}
                  item={item}
                  onOpen={onOpen}
                  large={mode === 'semana'}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Chip({
  item,
  onOpen,
  large,
}: {
  item: Item;
  onOpen: (id: string) => void;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      draggable
      className={`chip s-${item.status}${large ? ' large' : ''}`}
      title={`${item.title} · ${STATUS_LABEL[item.status]} · ${FORMAT_LABEL[item.format]}`}
      onDragStart={(event) => event.dataTransfer.setData('text/plain', item.id)}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={() => onOpen(item.id)}
    >
      <Thumb item={item} className="chip-thumb" />
      <span className="chip-text">
        <span className="chip-title">{item.title}</span>
        <span className="chip-meta">
          <span className="chip-dot" />
          {item.scheduled_at && timeLabel(item.scheduled_at)}
          {large && ` · ${FORMAT_LABEL[item.format]} · ${STATUS_LABEL[item.status]}`}
        </span>
      </span>
    </button>
  );
}
