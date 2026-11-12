import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTION_LABEL,
  type AppStatus,
  api,
  type Hook,
  type Planning,
  STATUS_LABEL,
  type Taxonomy,
  WEEKDAYS,
} from '../api.ts';
import { Icon, TokenInput } from '../ui.tsx';

type Props = { status: AppStatus; onSaved: () => void };

const TAXONOMY: { key: keyof Taxonomy; label: string; hint: string; tone: string }[] = [
  { key: 'pillars', label: 'Pilares', hint: 'Temas de los que habla la marca', tone: 'purple' },
  { key: 'services', label: 'Servicios', hint: 'Lo que se ofrece', tone: 'teal' },
  { key: 'funnel', label: 'Etapas', hint: 'Momentos del embudo', tone: 'orange' },
  { key: 'ctas', label: 'Llamadas a la acción', hint: 'Qué se le pide al lector', tone: 'pink' },
];

export function Automation({ status, onSaved }: Props) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [taxonomy, setTaxonomy] = useState(status.taxonomy);
  const [planning, setPlanning] = useState(status.planning);
  const [slot, setSlot] = useState({ weekday: 1, time: '12:00' });
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    const [hookList, agentList] = await Promise.all([
      api<Hook[]>('/hooks'),
      api<string[]>('/files/agents'),
    ]);
    setHooks(hookList);
    setAgents(agentList.map((name) => name.replace(/\.md$/, '')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function persist(action: () => Promise<unknown>, label: string) {
    setError('');
    try {
      await action();
      setSaved(label);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setSaved(''), 1800);
      onSaved();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const patch = (id: string, body: Partial<Hook>) =>
    persist(() => api(`/hooks/${id}`, 'PATCH', body).then(load), 'Guardado');

  function saveTaxonomy(next: Taxonomy) {
    setTaxonomy(next);
    persist(() => api('/taxonomy', 'PUT', next), 'Taxonomía guardada');
  }

  function savePlanning(next: Planning) {
    setPlanning(next);
    persist(
      () => api<Planning>('/planning', 'PUT', next).then(setPlanning),
      'Planificación guardada',
    );
  }

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Automatización</h1>
        <div className="spacer" />
        {error && <span className="error-text">{error}</span>}
        {saved && (
          <span className="saved">
            <Icon name="check" size={14} />
            {saved}
          </span>
        )}
      </header>
      <div className="scroll">
        <div className="list-section">
          <h2>Agentes automáticos</h2>
          <div className="list">
            {hooks.map((hook) => (
              <div key={hook.id} className="list-row static">
                <span className="list-main">
                  <b>{hook.name}</b>
                  <span className="muted">
                    {hook.trigger === 'weekly'
                      ? 'Cada semana'
                      : `Cuando una pieza pasa a ${STATUS_LABEL[hook.status ?? 'idea']}`}{' '}
                    → {ACTION_LABEL[hook.action]}
                  </span>
                </span>
                {hook.trigger === 'weekly' && (
                  <>
                    <select
                      value={hook.weekday ?? 0}
                      onChange={(event) => patch(hook.id, { weekday: Number(event.target.value) })}
                    >
                      {WEEKDAYS.map((name, index) => (
                        <option key={name} value={index}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={hook.time ?? '18:00'}
                      onChange={(event) => patch(hook.id, { time: event.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        persist(() => api(`/hooks/${hook.id}/fire`, 'POST'), 'En cola. Míralo en Actividad')
                      }
                    >
                      <Icon name="play" size={12} />
                      Ejecutar ahora
                    </button>
                  </>
                )}
                <select
                  value={hook.agent}
                  aria-label="Agente"
                  onChange={(event) => patch(hook.id, { agent: event.target.value })}
                >
                  {agents.map((agent) => (
                    <option key={agent} value={agent}>
                      {agent}
                    </option>
                  ))}
                </select>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={hook.enabled}
                    onChange={(event) => patch(hook.id, { enabled: event.target.checked })}
                  />
                  <span />
                </label>
              </div>
            ))}
          </div>
          <p className="muted note">Zona horaria: {status.timezone}</p>
        </div>

        <div className="list-section">
          <h2>Planificación</h2>
          <div className="list">
            <div className="list-row static">
              <span className="list-main">
                <b>Piezas por semana</b>
                <span className="muted">Cuántas ideas propone el planner si la estrategia no dice otra cosa</span>
              </span>
              <div className="stepper">
                <button
                  type="button"
                  aria-label="Menos"
                  disabled={planning.pieces <= 1}
                  onClick={() => savePlanning({ ...planning, pieces: planning.pieces - 1 })}
                >
                  −
                </button>
                <b>{planning.pieces}</b>
                <button
                  type="button"
                  aria-label="Más"
                  onClick={() => savePlanning({ ...planning, pieces: planning.pieces + 1 })}
                >
                  +
                </button>
              </div>
            </div>
            <div className="list-row static tall">
              <span className="list-main">
                <b>Horarios de publicación</b>
                <span className="muted">
                  El planner los prefiere y «Siguiente libre» los usa al programar una pieza
                </span>
                <span className="slots">
                  {planning.slots.map((entry) => (
                    <span key={`${entry.weekday}-${entry.time}`} className="token">
                      {WEEKDAYS[entry.weekday]} {entry.time}
                      <button
                        type="button"
                        aria-label="Quitar horario"
                        onClick={() =>
                          savePlanning({
                            ...planning,
                            slots: planning.slots.filter((other) => other !== entry),
                          })
                        }
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                  {!planning.slots.length && <span className="muted">Sin horarios.</span>}
                </span>
              </span>
              <select
                value={slot.weekday}
                aria-label="Día"
                onChange={(event) => setSlot({ ...slot, weekday: Number(event.target.value) })}
              >
                {WEEKDAYS.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={slot.time}
                aria-label="Hora"
                onChange={(event) => setSlot({ ...slot, time: event.target.value })}
              />
              <button
                type="button"
                onClick={() => {
                  const exists = planning.slots.some(
                    (entry) => entry.weekday === slot.weekday && entry.time === slot.time,
                  );
                  if (!exists) savePlanning({ ...planning, slots: [...planning.slots, slot] });
                }}
              >
                <Icon name="plus" size={14} />
                Agregar
              </button>
            </div>
          </div>
        </div>

        <div className="list-section">
          <h2>Taxonomía</h2>
          <div className="taxonomy">
            {TAXONOMY.map((group) => (
              <div key={group.key} className="taxonomy-card">
                <div className="taxonomy-head">
                  <b>{group.label}</b>
                  <span className="count">{taxonomy[group.key].length}</span>
                </div>
                <span className="muted">{group.hint}</span>
                <TokenInput
                  values={taxonomy[group.key]}
                  tone={group.tone}
                  placeholder="Agregar y pulsar Enter"
                  onChange={(values) => saveTaxonomy({ ...taxonomy, [group.key]: values })}
                />
              </div>
            ))}
          </div>
          <p className="muted note">Se guarda sola. Los agentes y el formulario de piezas usan estas listas.</p>
        </div>
      </div>
    </section>
  );
}
