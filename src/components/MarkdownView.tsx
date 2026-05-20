import MarkdownIt from 'markdown-it';
import React, { useMemo, useState, useRef, useEffect } from 'react';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

interface ReadOnlyProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: ReadOnlyProps): React.JSX.Element {
  const html = useMemo(() => md.render(source ?? ''), [source]);
  return (
    <div
      className={`markdown ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface EditableProps {
  source: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
  rows?: number;
}

/** Renders markdown that flips to a textarea on click; commits on blur or ⌘/Ctrl+Enter. */
export function EditableMarkdown({ source, onSave, placeholder, rows = 6 }: EditableProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(source);
  }, [source]);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(draft.length, draft.length);
    }
  }, [editing, draft.length]);

  const commit = async () => {
    setEditing(false);
    if (draft !== source) await onSave(draft);
  };
  const cancel = () => {
    setDraft(source);
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        rows={rows}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <div
      className="markdown editable"
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title="Click to edit"
    >
      {source.trim()
        ? <div dangerouslySetInnerHTML={{ __html: md.render(source) }} />
        : <p style={{ color: 'var(--fg-muted)' }}>{placeholder ?? 'Click to add…'}</p>}
    </div>
  );
}
