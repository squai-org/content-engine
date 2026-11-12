import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ENGINE_LABEL, FORMAT_LABEL, type Format, type TemplatePreview } from '../api.ts';
import { Frame, Icon, Segmented } from '../ui.tsx';
import { useFiles } from './Files.tsx';

type Props = { services: string[] };
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
        {preview?.slides.length ? (
          <Frame html={preview.slides[0]} width={preview.width} height={preview.height} fit={260} />
        ) : preview ? (
          <span className="engine-mark">
            <Icon name="video" size={30} />
            Abre el template para renderizar una muestra
          </span>
        ) : (
          <span className="muted">{error ? 'Sin vista previa' : 'Cargando…'}</span>
        )}
      </span>
      <b>
        {name.replace(/\.(html|tsx)$/, '')}
        {preview && preview.engine !== 'nativo' && <span className="tag engine">{ENGINE_LABEL[preview.engine]}</span>}
      </b>
      <span className="muted">
        {preview
          ? `${preview.formats.map((format) => FORMAT_LABEL[format as Format] ?? format).join(', ')} · ${preview.width}×${preview.height}`
          : error}
      </span>
    </button>
  );
}

export function Templates({ services }: Props) {
  const files = useFiles('templates');
  const [mode, setMode] = useState<Mode>('vista');
  const [service, setService] = useState(services[0] ?? '');
  const [replay, setReplay] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(520);
  const { loadList } = files;

  useEffect(() => {
    loadList();
  }, []);

  const measure = useCallback(() => {
    if (stage.current) setFit(Math.max(240, Math.min(640, stage.current.clientHeight - 56)));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, mode, files.current]);

  const isHtml = /\.(html|tsx)$/.test(files.current ?? '');
  const [sample, setSample] = useState<{ key: string; url: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const { preview, error } = usePreview(isHtml ? files.content : '', service, 350);
  const usesService = files.content.includes('{{service}}');
  const templates = files.names.filter((name) => /\.(html|tsx)$/.test(name));
  const others = files.names.filter((name) => !/\.(html|tsx)$/.test(name));
  const sampleKey = `${files.current}\n${service}\n${files.content}`;
  const isReel = preview?.formats.includes('reel') ?? false;

  async function renderSample() {
    setRendering(true);
    setSampleError('');
    try {
      const { url } = await api<{ url: string }>('/templates/sample', 'POST', {
        content: files.content,
        service,
      });
      setSample({ key: sampleKey, url });
    } catch (failure) {
      setSampleError((failure as Error).message);
    } finally {
      setRendering(false);
    }
  }

  if (!files.current) {
    return (
      <section className="view">
        <header className="toolbar">
          <h1 className="title">Templates</h1>
          <div className="spacer" />
          {files.error && <span className="error-text">{files.error}</span>}
          {services.length > 0 && (
            <Segmented
              value={service}
              options={services.map((entry) => ({ value: entry, label: entry }))}
              onChange={setService}
            />
          )}
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
            setSample(null);
            setMode('vista');
            loadList();
          }}
        >
          <Icon name="left" size={14} />
        </button>
        <h1 className="title file">{files.current}</h1>
        <div className="spacer" />
        {files.error && <span className="error-text">{files.error}</span>}
        {isHtml && usesService && services.length > 0 && (
          <Segmented
            value={service}
            options={services.map((entry) => ({ value: entry, label: entry }))}
            onChange={setService}
          />
        )}
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
        {isHtml && isReel && preview && preview.slides.length > 0 && (
          <button type="button" onClick={() => setReplay((count) => count + 1)}>
            <Icon name="play" size={12} />
            Repetir
          </button>
        )}
        {isHtml && isReel && (
          <button type="button" disabled={rendering} onClick={renderSample}>
            <Icon name="video" size={14} />
            {rendering ? 'Renderizando…' : 'Renderizar muestra'}
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
            {sampleError && <p className="banner error">{sampleError}</p>}
            {rendering && (
              <p className="banner working">
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
                Renderizando un video de muestra con {preview ? ENGINE_LABEL[preview.engine] : 'el motor'}. Puede tardar un
                minuto.
              </p>
            )}
            {sample?.key === sampleKey && (
              <video className="sample" src={sample.url} controls autoPlay loop muted playsInline style={{ height: fit }} />
            )}
            {preview && preview.slides.length === 0 && sample?.key !== sampleKey && !rendering && (
              <p className="empty">
                Los templates de Remotion no tienen vista previa en vivo. Pulsa «Renderizar muestra» para ver el video.
              </p>
            )}
            {preview && preview.slides.length > 0 && sample?.key !== sampleKey && (
              <>
                <div className="strip" key={replay}>
                  {preview.slides.map((html, index) => (
                    <Frame key={index} html={html} width={preview.width} height={preview.height} fit={fit} />
                  ))}
                </div>
                <p className="muted note">
                  {preview.engine === 'hyperframes'
                    ? 'Composición de muestra en bucle.'
                    : preview.slides.length > 1
                      ? `${preview.slides.length} láminas de muestra, contiguas como en la publicación.`
                      : 'Lámina de muestra.'}{' '}
                  El texto real lo escribe el agente. {preview.width}×{preview.height} ·{' '}
                  {preview.formats.map((format) => FORMAT_LABEL[format as Format] ?? format).join(', ')} ·{' '}
                  {ENGINE_LABEL[preview.engine]}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
