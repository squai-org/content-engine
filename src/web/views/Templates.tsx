import { useCallback, useEffect, useRef, useState } from 'react';
import { api, FORMAT_LABEL, type Format, type TemplatePreview } from '../api.ts';
import { Frame, Icon, Player, Segmented } from '../ui.tsx';
import { useFiles } from './Files.tsx';

type Props = {
  services: string[];
  sampling: boolean;
  onSample: (name: string, content: string, service: string) => void;
};
type Mode = 'vista' | 'codigo';

const STARTER = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="size" content="1080x1350">
<meta name="formats" content="post">
<style>
{{tokens}}
* { box-sizing: border-box; margin: 0; }
body { width: 1080px; height: 1350px; padding: 96px; background: var(--fondo); color: var(--texto); font-family: var(--fuente); display: flex; flex-direction: column; justify-content: center; gap: 40px; }
h1 { font-size: 88px; line-height: 1.08; }
p { font-size: 38px; line-height: 1.4; }
</style>
</head>
<body>
<h1>{{title}}</h1>
<p>{{body}}</p>
</body>
</html>
`;

const formats = (preview: TemplatePreview) =>
  preview.formats.map((format) => FORMAT_LABEL[format as Format] ?? format).join(', ');

function usePreview(content: string, service: string, delay: number) {
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!content) {
      setPreview(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api<TemplatePreview>('/templates/preview', 'POST', { content, service })
        .then((result) => {
          if (!live) return;
          setPreview(result);
          setError('');
        })
        .catch((failure) => live && setError((failure as Error).message));
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [content, service, delay]);
  return { preview, error };
}

function Card({ name, service, onOpen }: { name: string; service: string; onOpen: () => void }) {
  const [content, setContent] = useState('');
  useEffect(() => {
    api<{ content: string }>(`/files/templates/${name}`).then((file) => setContent(file.content));
  }, [name]);
  const { preview, error } = usePreview(content, service, 0);
  return (
    <button type="button" className="template-card" onClick={onOpen}>
      <span className="template-stage">
        {preview ? (
          <Frame html={preview.slides[0]} width={preview.width} height={preview.height} fit={260} />
        ) : (
          <span className="muted">{error ? 'Sin vista previa' : 'Cargando…'}</span>
        )}
      </span>
      <b>
        {name.replace(/\.html$/, '')}
        {preview?.engine === 'hyperframes' && (
          <span className={`tag engine${preview.footage ? ' footage' : ''}`}>
            {preview.footage ? 'Video grabado' : 'Motion'}
          </span>
        )}
      </b>
      <span className="muted">{preview ? `${formats(preview)} · ${preview.width}×${preview.height}` : error}</span>
    </button>
  );
}

export function Templates({ services, sampling, onSample }: Props) {
  const files = useFiles('templates');
  const [mode, setMode] = useState<Mode>('vista');
  const [service, setService] = useState(services[0] ?? '');
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(520);
  const { loadList } = files;

  useEffect(() => {
    loadList();
  }, [loadList]);

  const measure = useCallback(() => {
    if (stage.current) setFit(Math.max(240, Math.min(640, stage.current.clientHeight - 110)));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, mode, files.current]);

  const isHtml = files.current?.endsWith('.html') ?? false;
  const { preview, error } = usePreview(isHtml ? files.content : '', service, 350);
  const usesService = /\{\{(service|data)\}\}/.test(files.content);
  const templates = files.names.filter((name) => name.endsWith('.html'));
  const others = files.names.filter((name) => !name.endsWith('.html'));
  const motion = preview?.engine === 'hyperframes';
  const picker = services.length > 0 && (
    <Segmented
      value={service}
      options={services.map((entry) => ({ value: entry, label: entry }))}
      onChange={setService}
    />
  );

  if (!files.current) {
    return (
      <section className="view">
        <header className="toolbar">
          <h1 className="title">Templates</h1>
          <div className="spacer" />
          {files.error && <span className="error-text">{files.error}</span>}
          {picker}
          <button type="button" className="primary" onClick={() => files.create('.html', STARTER)}>
            <Icon name="plus" size={14} />
            Nuevo
          </button>
        </header>
        <div className="scroll">
          <div className="template-grid">
            {templates.map((name) => (
              <Card key={name} name={name} service={service} onOpen={() => files.open(name)} />
            ))}
          </div>
          {others.length > 0 && (
            <div className="list-section">
              <h2>Estilos compartidos</h2>
              <div className="list">
                {others.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="list-row"
                    onClick={() => {
                      setMode('codigo');
                      files.open(name);
                    }}
                  >
                    <Icon name="doc" size={16} />
                    <span className="list-main">
                      <b>{name}</b>
                      <span className="muted">Colores y tipografía que los templates insertan con {'{{tokens}}'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  const showCode = mode === 'codigo' || !isHtml;

  return (
    <section className="view">
      <header className="toolbar">
        <button
          type="button"
          className="round"
          aria-label="Volver"
          onClick={() => {
            if (files.dirty && !window.confirm('Hay cambios sin guardar. ¿Salir?')) return;
            files.close();
            setMode('vista');
            loadList();
          }}
        >
          <Icon name="left" size={14} />
        </button>
        <h1 className="title file">{files.current}</h1>
        <div className="spacer" />
        {files.error && <span className="error-text">{files.error}</span>}
        {isHtml && usesService && picker}
        {isHtml && (
          <Segmented
            value={mode}
            options={[
              { value: 'vista', label: 'Diseño' },
              { value: 'codigo', label: 'Código' },
            ]}
            onChange={setMode}
          />
        )}
        {motion && (
          <button
            type="button"
            disabled={sampling}
            title="Exporta un MP4 de prueba con contenido de muestra"
            onClick={() => onSample(files.current as string, files.content, service)}
          >
            <Icon name="video" size={14} />
            Exportar muestra
          </button>
        )}
        <button type="button" className="destructive" onClick={files.remove}>
          <Icon name="trash" size={14} />
          Eliminar
        </button>
        <button type="button" className="primary" disabled={!files.dirty} onClick={files.save}>
          Guardar
        </button>
      </header>
      <div className={`template-work${showCode && isHtml ? ' with-code' : ''}`}>
        {showCode && (
          <textarea
            className="editor"
            spellCheck={false}
            value={files.content}
            onChange={(event) => files.setContent(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                event.preventDefault();
                if (files.dirty) files.save();
              }
            }}
          />
        )}
        {isHtml && (
          <div className="template-preview" ref={stage}>
            {error && <p className="banner error">{error}</p>}
            {preview && motion && (
              <Player
                html={preview.slides[0]}
                width={preview.width}
                height={preview.height}
                fit={fit}
                duration={preview.duration ?? 0}
              />
            )}
            {preview && !motion && (
              <div className="strip">
                {preview.slides.map((html, index) => (
                  <Frame key={index} html={html} width={preview.width} height={preview.height} fit={fit} />
                ))}
              </div>
            )}
            {preview && (
              <p className="muted note">
                {motion
                  ? preview.footage
                    ? 'Animaciones de muestra sobre un fondo neutro. En la pieza van encima del video grabado.'
                    : 'Composición de muestra.'
                  : preview.slides.length > 1
                    ? `${preview.slides.length} láminas de muestra, contiguas como en la publicación.`
                    : 'Lámina de muestra.'}{' '}
                El texto real lo escribe el agente. {preview.width}×{preview.height} · {formats(preview)}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
