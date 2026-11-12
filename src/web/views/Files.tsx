import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Icon, Markdown, Segmented, splitFrontmatter } from '../ui.tsx';

type Props = { kind: string; title: string; extension: string };
type Mode = 'vista' | 'editar';
type Editing = { at: number | 'meta'; text: string } | null;

const ZOOM_KEY = 'md-zoom';
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.15;

function readZoom(): number {
  try {
    const saved = Number(window.localStorage.getItem(ZOOM_KEY));
    return saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : 1;
  } catch {
    return 1;
  }
}

const LIST_ITEM = /^([-*]|\d+\.)\s/;

function splitSource(source: string): { front: string; blocks: string[] } {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(source);
  const front = match ? match[0].trimEnd() : '';
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of source.slice(match ? match[0].length : 0).split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (!line.trim() && !fenced) {
      if (current.length) blocks.push(current.join('\n'));
      current = [];
      continue;
    }
    if (!fenced && LIST_ITEM.test(line) && current.length && LIST_ITEM.test(current[0])) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return { front, blocks };
}

function joinSource(front: string, blocks: string[]): string {
  const kept = blocks.map((block) => block.replace(/\s+$/, '')).filter((block) => block.trim());
  const body = kept
    .map((block, index) => {
      const next = kept[index + 1];
      if (next === undefined) return block;
      return `${block}${LIST_ITEM.test(block) && LIST_ITEM.test(next) ? '\n' : '\n\n'}`;
    })
    .join('');
  return `${[front.trim(), body].filter(Boolean).join('\n\n')}\n`;
}

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
  const [editing, setEditing] = useState<Editing>(null);
  const [zoom, setZoom] = useState(readZoom);
  const { loadList, open, close } = files;

  useEffect(() => {
    close();
    setMode('vista');
    setEditing(null);
    loadList().then((list) => {
      if (list[0]) open(list[0]);
    });
  }, [kind]);

  function changeZoom(step: number) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom + step) * 100) / 100));
    setZoom(next);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {}
  }

  const { front, blocks } = splitSource(files.content);
  const { meta } = splitFrontmatter(files.content);

  function commit() {
    if (!editing) return;
    const next = [...blocks];
    if (editing.at === 'meta') files.setContent(joinSource(editing.text, blocks));
    else {
      next[editing.at] = editing.text;
      files.setContent(joinSource(front, next));
    }
    setEditing(null);
  }

  const saveKey = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      commit();
      setTimeout(files.save, 0);
    } else if (event.key === 'Escape') {
      commit();
    }
  };

  const field = (mono: boolean) => (
    <textarea
      className={`block-editor${mono ? ' mono' : ''}`}
      autoFocus
      spellCheck={!mono}
      rows={(editing?.text.split('\n').length ?? 1) + 1}
      value={editing?.text ?? ''}
      onChange={(event) => setEditing(editing && { ...editing, text: event.target.value })}
      onFocus={(event) => event.target.setSelectionRange(event.target.value.length, event.target.value.length)}
      onBlur={commit}
      onKeyDown={saveKey}
    />
  );

  return (
    <section className="view">
      <header className="toolbar">
        <h1 className="title">{title}</h1>
        <div className="spacer" />
        {files.error && <span className="error-text">{files.error}</span>}
        {files.current && (
          <div className="segmented" role="group" aria-label="Tamaño del texto">
            <button type="button" aria-label="Reducir texto" disabled={zoom <= ZOOM_MIN} onClick={() => changeZoom(-ZOOM_STEP)}>
              <Icon name="minus" size={14} />
            </button>
            <button type="button" title="Tamaño normal" onClick={() => changeZoom(1 - zoom)}>
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" aria-label="Aumentar texto" disabled={zoom >= ZOOM_MAX} onClick={() => changeZoom(ZOOM_STEP)}>
              <Icon name="plus" size={14} />
            </button>
          </div>
        )}
        {files.current && (
          <Segmented
            value={mode}
            options={[
              { value: 'vista', label: 'Documento' },
              { value: 'editar', label: 'Markdown' },
            ]}
            onChange={(next) => {
              commit();
              setMode(next);
            }}
          />
        )}
        {files.current && (
          <button type="button" className="destructive" onClick={files.remove}>
            <Icon name="trash" size={14} />
            Eliminar
          </button>
        )}
        <button type="button" onClick={() => files.create(extension)}>
          <Icon name="plus" size={14} />
          Nuevo
        </button>
        {files.current && (
          <button type="button" className="primary" disabled={!files.dirty} onClick={files.save}>
            {files.dirty ? 'Guardar' : 'Guardado'}
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
              onClick={() => {
                if (files.dirty && !window.confirm('Hay cambios sin guardar. ¿Salir?')) return;
                setEditing(null);
                files.open(name);
              }}
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
            style={{ zoom }}
            spellCheck={false}
            value={files.content}
            onChange={(event) => files.setContent(event.target.value)}
            onKeyDown={saveKey}
          />
        )}
        {files.current && mode === 'vista' && (
          <div className="reader">
            <article style={{ zoom }}>
              {(meta.length > 0 || editing?.at === 'meta') &&
                (editing?.at === 'meta' ? (
                  field(true)
                ) : (
                  <dl className="meta editable" title="Clic para editar" onClick={() => setEditing({ at: 'meta', text: front })}>
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
                ))}
              {blocks.map((block, index) =>
                editing?.at === index ? (
                  <div key={`e${index}`}>{field(false)}</div>
                ) : (
                  <div
                    key={`${index}-${block.slice(0, 24)}`}
                    className="editable"
                    title="Clic para editar"
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a')) return;
                      setEditing({ at: index, text: block });
                    }}
                  >
                    <Markdown source={block} />
                  </div>
                ),
              )}
              {editing?.at !== blocks.length && (
                <button type="button" className="plain add-block" onClick={() => setEditing({ at: blocks.length, text: '' })}>
                  <Icon name="plus" size={14} />
                  Agregar texto
                </button>
              )}
              {editing?.at === blocks.length && <div>{field(false)}</div>}
            </article>
          </div>
        )}
      </div>
    </section>
  );
}
