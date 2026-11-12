import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type AppStatus, api, type Item, Unauthorized } from './api.ts';
import { Icon } from './ui.tsx';
import { Activity } from './views/Activity.tsx';
import { Analytics } from './views/Analytics.tsx';
import { Automation } from './views/Automation.tsx';
import { Calendar } from './views/Calendar.tsx';
import { Connections } from './views/Connections.tsx';
import { Files } from './views/Files.tsx';
import { ItemModal } from './views/ItemModal.tsx';
import { Review } from './views/Review.tsx';
import { Server } from './views/Server.tsx';
import { Templates } from './views/Templates.tsx';

type View =
  | 'calendario'
  | 'revision'
  | 'analitica'
  | 'bases'
  | 'templates'
  | 'skills'
  | 'agents'
  | 'actividad'
  | 'automatizacion'
  | 'conexiones'
  | 'servidor';
export type Draft = { scheduled_at: string | null };

type Entry = { id: View; label: string; icon: string; tone: string };

const NAV: { group: string; entries: Entry[] }[] = [
  {
    group: 'Contenido',
    entries: [
      { id: 'calendario', label: 'Calendario', icon: 'calendar', tone: 'red' },
      { id: 'revision', label: 'Revisión', icon: 'check', tone: 'blue' },
      { id: 'analitica', label: 'Analítica', icon: 'chart', tone: 'pink' },
    ],
  },
  {
    group: 'Biblioteca',
    entries: [
      { id: 'bases', label: 'Documentos', icon: 'doc', tone: 'orange' },
      { id: 'templates', label: 'Templates', icon: 'layout', tone: 'purple' },
      { id: 'skills', label: 'Skills', icon: 'sparkle', tone: 'yellow' },
      { id: 'agents', label: 'Agentes', icon: 'agent', tone: 'teal' },
    ],
  },
  {
    group: 'Sistema',
    entries: [
      { id: 'actividad', label: 'Actividad', icon: 'activity', tone: 'green' },
      { id: 'automatizacion', label: 'Automatización', icon: 'bolt', tone: 'indigo' },
      { id: 'conexiones', label: 'Conexiones', icon: 'link', tone: 'blue' },
      { id: 'servidor', label: 'Servidor', icon: 'server', tone: 'gray' },
    ],
  },
];

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/login', 'POST', { password });
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  return (
    <form className="login glass" onSubmit={submit}>
      <span className="app-mark">
        <Icon name="sparkle" size={26} />
      </span>
      <h1>Contenido</h1>
      <input
        type="password"
        placeholder="Contraseña"
        value={password}
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      />
      <button className="primary" type="submit">
        Entrar
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}

export function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [locked, setLocked] = useState(false);
  const returned = new URLSearchParams(window.location.search);
  const [view, setView] = useState<View>(returned.has('conexion') ? 'conexiones' : 'calendario');
  const [notice] = useState(returned.get('conexion') === 'error' ? (returned.get('motivo') ?? '') : '');
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [job, setJob] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await api<Item[]>('/items'));
      setLocked(false);
    } catch (failure) {
      if (failure instanceof Unauthorized) setLocked(true);
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      setStatus(await api<AppStatus>('/status'));
      setLocked(false);
      await refresh();
    } catch (failure) {
      if (failure instanceof Unauthorized) setLocked(true);
    }
  }, [refresh]);

  useEffect(() => {
    boot();
    if (window.location.search) window.history.replaceState(null, '', '/');
  }, [boot]);

  useEffect(() => {
    if (locked || !status) return;
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [locked, status, refresh]);

  const close = useCallback(() => {
    setSelected(null);
    setDraft(null);
  }, []);

  if (locked) return <Login onDone={boot} />;
  if (!status) return null;

  const pending = items.filter((item) => item.status === 'revision').length;
  const open = (id: string) => {
    setDraft(null);
    setSelected(id);
  };
  const showJob = (id: string) => {
    close();
    setJob(id);
    setView('actividad');
  };

  return (
    <div className="shell">
      <nav className="sidebar glass">
        <div className="brand">
          <span className="app-mark small">
            <Icon name="sparkle" size={15} />
          </span>
          Contenido
        </div>
        {NAV.map((section) => (
          <div key={section.group} className="nav-group">
            <div className="nav-title">{section.group}</div>
            {section.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`nav-item${view === entry.id ? ' active' : ''}`}
                onClick={() => setView(entry.id)}
              >
                <span className="nav-icon" style={{ '--tone': `var(--${entry.tone})` } as React.CSSProperties}>
                  <Icon name={entry.icon} size={14} />
                </span>
                <span className="nav-label">{entry.label}</span>
                {entry.id === 'revision' && pending > 0 && <span className="badge">{pending}</span>}
              </button>
            ))}
          </div>
        ))}
        <button type="button" className="sidebar-foot" onClick={() => setView('conexiones')}>
          <span className={`dot ${status.instagram ? 'ok' : 'off'}`} />
          {status.instagram ? 'Instagram conectado' : 'Instagram sin conectar'}
        </button>
      </nav>
      <main className="content glass">
        {status.paused && <p className="banner error flush">{status.paused}</p>}
        {view === 'calendario' && (
          <Calendar
            items={items}
            onOpen={open}
            onCreate={(scheduled_at) => {
              setSelected(null);
              setDraft({ scheduled_at });
            }}
            onChanged={refresh}
          />
        )}
        {view === 'revision' && <Review items={items} onOpen={open} />}
        {view === 'analitica' && <Analytics connected={status.instagram} />}
        {view === 'bases' && <Files kind="bases" title="Documentos" extension=".md" />}
        {view === 'templates' && <Templates services={status.taxonomy.services} />}
        {view === 'skills' && <Files kind="skills" title="Skills" extension="" />}
        {view === 'agents' && <Files kind="agents" title="Agentes" extension=".md" />}
        {view === 'actividad' && (
          <Activity selected={job} onSelect={setJob} onOpenItem={open} onChanged={refresh} />
        )}
        {view === 'automatizacion' && <Automation status={status} onSaved={boot} />}
        {view === 'conexiones' && <Connections notice={notice} onChanged={boot} />}
        {view === 'servidor' && <Server />}
      </main>
      {(selected !== null || draft !== null) && (
        <ItemModal
          key={selected ?? 'nuevo'}
          itemId={selected}
          draft={draft}
          taxonomy={status.taxonomy}
          onClose={close}
          onChanged={refresh}
          onShowJob={showJob}
          onCreated={(id) => {
            setDraft(null);
            setSelected(id);
            refresh();
          }}
        />
      )}
    </div>
  );
}
