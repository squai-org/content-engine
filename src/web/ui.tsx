import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { isVideo, type Item } from './api.ts';

const ICONS: Record<string, string> = {
  calendar: 'M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  check: 'M4 12.5 9.5 18 20 6.5',
  chart: 'M5 20V11M12 20V4M19 20v-6',
  doc: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h5M9 13h6M9 17h4',
  layout: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4 10h16M10 10v10',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8ZM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z',
  agent: 'M12 3v3M8 6h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3ZM9.5 11v2M14.5 11v2M9 21h6',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  server: 'M5 4h14a1 1 0 0 1 1 1v5H4V5a1 1 0 0 1 1-1ZM4 10h16v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM8 7h.01M8 13h.01M9 20h6M12 16v4',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  play: 'M7 4.5v15l12-7.5Z',
  stop: 'M7 7h10v10H7Z',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  video: 'M4 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM16 10l4-2.5v9L16 14',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM4 16l4.5-4.5L13 16l3-3 4 4M15 9h.01',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  pencil: 'M4 20l4-1L19 8l-3-3L5 16ZM14 7l3 3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z',
  send: 'M4 12 20 4l-6 16-3-7Z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.500-7 10-7 10Z',
  users: 'M9 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7ZM3 20a6 6 0 0 1 12 0M16 4.500a3.500 3.500 0 0 1 0 6.500M17 14.500a6 6 0 0 1 4 5.500',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function Modal({
  onClose,
  children,
  wide,
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? 'on' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TokenInput({
  values,
  onChange,
  placeholder,
  tone,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  tone: string;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    setDraft('');
    if (value && !values.includes(value)) onChange([...values, value]);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="tokens" style={{ '--tone': `var(--${tone})` } as React.CSSProperties}>
      {values.map((value) => (
        <span key={value} className="token">
          {value}
          <button
            type="button"
            aria-label={`Quitar ${value}`}
            onClick={() => onChange(values.filter((entry) => entry !== value))}
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKey}
        onBlur={add}
      />
    </div>
  );
}

export function Thumb({ item, className = 'thumb' }: { item: Item; className?: string }) {
  const [asset] = item.assets;
  if (!asset) {
    return (
      <span className={`${className} blank`}>
        <Icon name={item.format === 'reel' ? 'video' : 'image'} size={14} />
      </span>
    );
  }
  return isVideo(asset) ? (
    <video className={className} src={`/media/${asset}#t=2.5`} muted preload="metadata" />
  ) : (
    <img className={className} src={`/media/${asset}`} alt="" loading="lazy" />
  );
}

export function Frame({
  html,
  width,
  height,
  fit,
}: {
  html: string;
  width: number;
  height: number;
  fit: number;
}) {
  const scale = fit / height;
  return (
    <div className="frame" style={{ width: width * scale, height: fit }}>
      <iframe
        title="Vista previa"
        sandbox="allow-scripts"
        srcDoc={html}
        width={width}
        height={height}
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}

export function Ring({
  value,
  tone,
  label,
  detail,
}: {
  value: number;
  tone: string;
  label: string;
  detail: string;
}) {
  const ratio = Math.min(1, Math.max(0, value));
  const length = 2 * Math.PI * 42;
  return (
    <div className="ring-card" style={{ '--tone': `var(--${tone})` } as React.CSSProperties}>
      <svg viewBox="0 0 100 100" role="img" aria-label={`${label}: ${Math.round(ratio * 100)} %`}>
        <circle className="ring-track" cx="50" cy="50" r="42" />
        <circle
          className="ring-value"
          cx="50"
          cy="50"
          r="42"
          strokeDasharray={`${length * ratio} ${length}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="56" textAnchor="middle">
          {ratio < 0.01 && ratio > 0 ? '<1' : Math.round(ratio * 100)}%
        </text>
      </svg>
      <b>{label}</b>
      <span className="muted">{detail}</span>
    </div>
  );
}

export function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return <div className="spark empty muted">Reuniendo datos…</div>;
  const width = 600;
  const height = 120;
  const top = Math.max(0.05, ...values);
  const points = values.map(
    (value, index) =>
      `${((index / (values.length - 1)) * width).toFixed(1)},${(height - (value / top) * (height - 8) - 2).toFixed(1)}`,
  );
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ '--tone': `var(--${tone})` } as React.CSSProperties}
      aria-hidden="true"
    >
      <polygon points={`0,${height} ${points.join(' ')} ${width},${height}`} />
      <polyline points={points.join(' ')} />
    </svg>
  );
}

export function useAutoScroll(dependency: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [dependency]);
  return {
    ref,
    onScroll: () => {
      const node = ref.current;
      if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    },
  };
}

function inline(text: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const id = `${key}-${count}`;
    count += 1;
    if (token.startsWith('**')) nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={id}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)]+)\)/.exec(token) as RegExpExecArray;
      nodes.push(
        /^https?:\/\//.test(href) ? (
          <a key={id} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (token.startsWith('http')) {
      nodes.push(
        <a key={id} href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      );
    } else nodes.push(<em key={id}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function splitFrontmatter(source: string): { meta: [string, string][]; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { meta: [], body: source };
  const meta = match[1]
    .split('\n')
    .map((line) => /^([\w-]+):\s*(.*)$/.exec(line))
    .filter((entry): entry is RegExpExecArray => entry !== null)
    .map((entry) => [entry[1], entry[2]] as [string, string]);
  return { meta, body: source.slice(match[0].length) };
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  const key = () => `b${blocks.length}`;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) code.push(lines[index++]);
      index += 1;
      blocks.push(<pre key={key()}>{code.join('\n')}</pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3' | 'h4';
      blocks.push(<Tag key={key()}>{inline(heading[2], key())}</Tag>);
      index += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key()} />);
      index += 1;
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) rows.push(cells(lines[index++]));
      const id = key();
      blocks.push(
        <div key={id} className="table-wrap">
          <table>
            <thead>
              <tr>
                {head.map((cell, column) => (
                  <th key={`${id}-h${column}`}>{inline(cell, `${id}-h${column}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${id}-r${rowIndex}`}>
                  {row.map((cell, column) => (
                    <td key={`${id}-r${rowIndex}-${column}`}>
                      {inline(cell, `${id}-r${rowIndex}-${column}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*([-*]|\d+\.)\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const entries: string[] = [];
      while (index < lines.length && (bullet.test(lines[index]) || /^\s{2,}\S/.test(lines[index]))) {
        if (bullet.test(lines[index])) entries.push(lines[index].replace(bullet, ''));
        else entries[entries.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      const Tag = ordered ? 'ol' : 'ul';
      const id = key();
      blocks.push(
        <Tag key={id}>
          {entries.map((entry, entryIndex) => (
            <li key={`${id}-${entryIndex}`}>{inline(entry, `${id}-${entryIndex}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith('>')) {
        quote.push(lines[index++].replace(/^>\s?/, ''));
      }
      blocks.push(<blockquote key={key()}>{inline(quote.join(' '), key())}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,4}\s|```|>|\s*([-*]|\d+\.)\s|\|)/.test(lines[index])
    ) {
      paragraph.push(lines[index++]);
    }
    if (!paragraph.length) paragraph.push(lines[index++]);
    blocks.push(<p key={key()}>{inline(paragraph.join(' '), key())}</p>);
  }
  return <div className="prose">{blocks}</div>;
}
