import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Icon, Markdown, Segmented, splitFrontmatter } from '../ui.tsx';

type Props = { kind: string; title: string; extension: string };
type Mode = 'vista' | 'editar';

const META_LABEL: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  tools: 'Herramientas',
  model: 'Modelo',
  skills: 'Skills',
};

export function useFiles(kind: string) {
  const [names, setNames] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const open = useCallback(
    async (name: string) => {
      const file = await api<{ content: string }>(`/files/${kind}/${name}`);
      setCurrent(name);
      setContent(file.content);
      setSaved(file.content);
    },
    [kind],
  );

  const loadList = useCallback(async () => {
    const list = await api<string[]>(`/files/${kind}`);
    setNames(list);
    return list;
  }, [kind]);

  async function guard(action: () => Promise<void>) {
    setError('');
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const close = () => {
    setCurrent(null);
    setContent('');
    setSaved('');
  };

  return {
    names,
    current,
    content,
    setContent,
    error,
    dirty: content !== saved,
    loadList,
    close,
    open: (name: string) => guard(() => open(name)),
    save: () =>
      guard(async () => {
        await api(`/files/${kind}/${current}`, 'PUT', { content });
        setSaved(content);
      }),
    create: (extension: string, initial = '') =>
      guard(async () => {
        const typed = window.prompt('Nombre en minúsculas, con guiones');
        if (!typed) return;
        const base = typed.trim().toLowerCase();
        const name = extension && !base.includes('.') ? `${base}${extension}` : base;
        await api(`/files/${kind}/${name}`, 'PUT', { content: initial });
        await loadList();
        await open(name);
      }),
    remove: () =>
      guard(async () => {
        if (!current || !window.confirm(`¿Eliminar ${current}?`)) return;
        await api(`/files/${kind}/${current}`, 'DELETE');
        close();
        await loadList();
      }),
  };
}

export function Files({ kind, title, extension }: Props) {
  const files = useFiles(kind);
  const [mode, setMode] = useState<Mode>('vista');
  const { loadList, open, close } = files;

  useEffect(() => {
    close();
    setMode('vista');
    loadList().then((list) => {
      if (list[0]) open(list[0]);
    });
  }, [kind]);

  const { meta, body } = splitFrontmatter(files.content);

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">{title}</h1>
        <div className="spacer" />
        {files.error && <span className="error-text">{files.error}</span>}
        {files.current && (
          <Segmented
            value={mode}
            options={[
              { value: 'vista', label: 'Vista' },
              { value: 'editar', label: 'Editar' },
            ]}
            onChange={setMode}
          />
        )}
        {files.current && (
          <button type="button" className="destructive" onClick={files.remove}>
            <Icon name="trash" size={14} />
            Eliminar
          </button>
        )}
        <button type="button" onClick={() => files.create(extension).then(() => setMode('editar'))}>
          <Icon name="plus" size={14} />
          Nuevo
        </button>
        {(mode === 'editar' || files.dirty) && (
          <button type="button" className="primary" disabled={!files.dirty} onClick={files.save}>
            Guardar
          </button>
        )}
      </header>
      <div className="split">
        <div className="file-list">
          {files.names.map((name) => (
            <button
              key={name}
              type="button"
              className={`file-item${name === files.current ? ' active' : ''}`}
              onClick={() => files.open(name)}
            >
              <Icon name="doc" size={15} />
              <span>{name.replace(/\.md$/, '')}</span>
            </button>
          ))}
        </div>
        {!files.current && <p className="empty">Nada seleccionado.</p>}
        {files.current && mode === 'editar' && (
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
        {files.current && mode === 'vista' && (
          <div className="reader">
            <article>
              {meta.length > 0 && (
                <dl className="meta">
                  {meta.map(([key, value]) => (
                    <div key={key}>
                      <dt>{META_LABEL[key] ?? key}</dt>
                      <dd>
                        {key === 'tools' || key === 'skills'
                          ? value.split(',').map((entry) => (
                              <span key={entry} className="tag">
                                {entry.trim()}
                              </span>
                            ))
                          : value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {body.trim() ? (
                <Markdown source={body} />
              ) : (
                <p className="empty">Documento vacío. Pulsa Editar para escribir.</p>
              )}
            </article>
          </div>
        )}
      </div>
    </section>
  );
}
