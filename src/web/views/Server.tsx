import { useCallback, useEffect, useState } from 'react';
import { api, type ServerSnapshot } from '../api.ts';
import { Icon, Ring, Sparkline } from '../ui.tsx';

const GB = 1024 ** 3;

function size(bytes: number): string {
  if (bytes >= 1024 * GB) return `${(bytes / (1024 * GB)).toFixed(2)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} d ${hours} h` : `${hours} h ${Math.floor((seconds % 3600) / 60)} min`;
}

export function Server() {
  const [data, setData] = useState<ServerSnapshot | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<ServerSnapshot>('/server'));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <section className="view">
        <header className="toolbar">
          <h1 className="title">Servidor</h1>
        </header>
        <p className="empty">{error || 'Cargando…'}</p>
      </section>
    );
  }

  const { limits, disk } = data;
  const egressLimit = limits.egressTb * 1024 * GB;
  const other = Math.max(0, disk.used - disk.media - disk.workspace - disk.database);
  const parts = [
    { label: 'Piezas y videos', bytes: disk.media, tone: 'purple' },
    { label: 'Documentos y templates', bytes: disk.workspace, tone: 'orange' },
    { label: 'Base de datos', bytes: disk.database, tone: 'teal' },
    { label: 'Sistema y otros', bytes: other, tone: 'gray' },
  ];
  const healthy = data.warnings.length === 0;

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">Servidor</h1>
        <div className="spacer" />
        <span className={`pill ${healthy ? 'j-done' : 'j-failed'}`}>
          {healthy ? 'Dentro de la capa gratuita' : 'Requiere atención'}
        </span>
      </header>
      <div className="scroll">
        {data.warnings.map((warning) => (
          <p key={warning} className="banner error">
            {warning}
          </p>
        ))}
        <div className="rings">
          <Ring
            value={data.cpu.used}
            tone="blue"
            label="Procesador"
            detail={`${data.cpu.cores} de ${limits.ocpu} núcleos gratuitos`}
          />
          <Ring
            value={data.memory.used / data.memory.total}
            tone="green"
            label="Memoria"
            detail={`${size(data.memory.used)} de ${size(data.memory.total)}`}
          />
          <Ring
            value={disk.used / disk.total}
            tone="purple"
            label="Disco"
            detail={`${size(disk.used)} de ${size(disk.total)}`}
          />
          <Ring
            value={data.egress.bytes / egressLimit}
            tone="orange"
            label="Tráfico del mes"
            detail={`${size(data.egress.bytes)} de ${limits.egressTb} TB`}
          />
        </div>

        <div className="list-section">
          <h2>Procesador, últimas 24 horas</h2>
          <div className="panel">
            <Sparkline values={data.history.map((sample) => sample.cpu)} tone="blue" />
          </div>
        </div>

        <div className="list-section">
          <h2>En qué se usa el disco</h2>
          <div className="panel">
            <div className="bar">
              {parts.map((part) => (
                <i
                  key={part.label}
                  style={{ flexGrow: Math.max(part.bytes, disk.total / 400), background: `var(--${part.tone})` }}
                />
              ))}
              <i className="free" style={{ flexGrow: disk.total - disk.used }} />
            </div>
            <div className="legend">
              {parts.map((part) => (
                <span key={part.label}>
                  <i style={{ background: `var(--${part.tone})` }} />
                  {part.label} <b>{size(part.bytes)}</b>
                </span>
              ))}
              <span>
                <i className="free" />
                Libre <b>{size(disk.total - disk.used)}</b>
              </span>
            </div>
          </div>
        </div>

        <div className="list-section">
          <h2>Capa gratuita de Oracle</h2>
          <div className="list">
            {[
              ['Cómputo', `${limits.ocpu} OCPU y ${limits.memoryGb} GB de memoria`, `Esta máquina: ${data.cpu.cores} núcleos y ${size(data.memory.total)}`],
              ['Almacenamiento', `${limits.storageGb} GB en total entre discos`, `Disco de esta máquina: ${size(disk.total)}`],
              ['Tráfico de salida', `${limits.egressTb} TB al mes`, `Este mes: ${size(data.egress.bytes)}`],
            ].map(([name, limit, current]) => (
              <div key={name} className="list-row static">
                <Icon name="check" size={16} />
                <span className="list-main">
                  <b>{name}</b>
                  <span className="muted">Gratis hasta {limit}</span>
                </span>
                <span className="muted">{current}</span>
              </div>
            ))}
          </div>
          <p className="muted note">
            Los agentes corren de uno en uno y se pausan si quedan menos de 2 GB libres. Encendido hace{' '}
            {uptime(data.uptime)} · {data.jobsToday} ejecuciones en las últimas 24 horas.
          </p>
        </div>
      </div>
    </section>
  );
}
