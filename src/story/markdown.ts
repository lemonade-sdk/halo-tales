/**
 * Lightweight YAML-ish frontmatter for character markdown files.
 *
 * We intentionally keep this dumber than full YAML so we don't pull in a
 * 30 KB parser for what is effectively `key: value` pairs the agent writes.
 *
 *   ---
 *   role: antagonist
 *   allegiance: The Black Carriage
 *   ---
 *
 *   # Dr. Vance
 *   …body…
 */

export interface Frontmatter {
  traits: Record<string, string>;
  body: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function parseFrontmatter(source: string): Frontmatter {
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { traits: {}, body: source };
  const traits: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    // strip matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) traits[key] = value;
  }
  const body = source.slice(match[0].length);
  return { traits, body };
}

export function serializeFrontmatter({ traits, body }: Frontmatter): string {
  const keys = Object.keys(traits);
  if (keys.length === 0) return body;
  const lines = keys.map((k) => {
    const v = traits[k] ?? '';
    // Quote if the value contains characters that would confuse parseFrontmatter.
    const needsQuote = /[:#"']/.test(v) || /^\s|\s$/.test(v);
    return `${k}: ${needsQuote ? JSON.stringify(v) : v}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`;
}

/** Update or add a single trait without disturbing the rest of the file. */
export function withTrait(source: string, key: string, value: string): string {
  const { traits, body } = parseFrontmatter(source);
  traits[key] = value;
  return serializeFrontmatter({ traits, body });
}
