/**
 * Member avatars: original glyphs, a deterministic colour per member name,
 * and the React component that draws them.
 *
 * The Harness has no avatar concept for agents, so the board owns its own:
 * a member gets a glyph chosen from the set by their name, and a person can
 * pin a different one. The choice is stored per member name, so it survives
 * a reload and follows the member wherever the team appears.
 */
import { createElement as h } from 'react';

/** Where the pinned choices live in the browser's own storage. */
export const STORAGE_KEY = 'dsh.agent-team-board.avatars';

/**
 * The glyph set a member can be assigned. Every glyph is original artwork
 * drawn on a 16×16 grid.
 */
export const GLYPHS = [
  {
    id: 'compass',
    label: 'Compass',
    paths: ['M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z', 'M10.8 5.2 9.6 9.6 5.2 10.8 6.4 6.4Z'],
  },
  {
    id: 'braces',
    label: 'Braces',
    paths: ['M6.3 3.2C5 3.2 5 4.6 5 5.9v.9c0 1-.5 1.6-1.3 1.6.8 0 1.3.6 1.3 1.6v.9c0 1.3 0 2.7 1.3 2.7', 'M9.7 3.2c1.3 0 1.3 1.4 1.3 2.7v.9c0 1 .5 1.6 1.3 1.6-.8 0-1.3.6-1.3 1.6v.9c0 1.3 0 2.7-1.3 2.7'],
  },
  {
    id: 'document',
    label: 'Document',
    paths: ['M4.2 2.6h4.6l3.1 3.1v7.7H4.2Z', 'M8.8 2.6v3.1h3.1', 'M6.2 8.6h3.7', 'M6.2 10.8h3.7'],
  },
  {
    id: 'checklist',
    label: 'Checklist',
    paths: ['M2.6 4.6 4 6l2.4-2.9', 'M2.6 10.2 4 11.6l2.4-2.9', 'M8.6 4.4h4.8', 'M8.6 10.6h4.8'],
  },
  {
    id: 'terminal',
    label: 'Terminal',
    paths: ['M2.8 4.4 6.2 8l-3.4 3.6', 'M8.4 12h4.8'],
  },
  {
    id: 'chart',
    label: 'Chart',
    paths: ['M2.6 13.4h10.8', 'M4.6 13.4V8.8', 'M7.4 13.4V4.6', 'M10.2 13.4V6.8', 'M12.6 13.4v-3.2'],
  },
  {
    id: 'rocket',
    label: 'Rocket',
    paths: ['M8 2.2c1.9 1.6 2.9 3.6 2.9 5.6l-1.5 2.1h-2.8L5.1 7.8c0-2 1-4 2.9-5.6Z', 'M8 5.9v.01', 'M5.6 9.9 4 12l2-.6', 'M10.4 9.9 12 12l-2-.6'],
  },
  {
    id: 'wrench',
    label: 'Wrench',
    paths: ['M10.6 2.9a3.2 3.2 0 0 0-4 4.1L3.4 10a1.5 1.5 0 0 0 2.1 2.1l3-3a3.2 3.2 0 0 0 4.1-4l-1.9 1.9-1.9-1.9Z'],
  },
];

/**
 * Hash one string into a non-negative integer.
 * @param {string} text - the text to hash.
 * @returns {number} a stable hash.
 */
function hashOf(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The glyph a member gets when nothing is pinned.
 * @param {string} name - the member name.
 * @returns {object} the glyph record.
 */
export function glyphFor(name) {
  return GLYPHS[hashOf(name) % GLYPHS.length];
}

/**
 * The hue a member's avatar is drawn in.
 * @param {string} name - the member name.
 * @returns {number} a hue in degrees.
 */
export function hueFor(name) {
  return hashOf(name) % 360;
}

/**
 * The initials of a member name, for the fallback face.
 * @param {string} name - the member name.
 * @returns {string} one or two upper-case letters.
 */
export function initialsOf(name) {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Read the pinned glyph choices.
 * @returns {Record<string, string>} the pinned glyph id per member name.
 */
export function readAssignments() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return {};
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Pin one member's glyph.
 * @param {string} name - the member name.
 * @param {string | undefined} glyphId - the glyph id, or undefined to reset.
 */
export function writeAssignment(name, glyphId) {
  const assignments = readAssignments();
  if (glyphId === undefined) delete assignments[name];
  else assignments[name] = glyphId;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // A browser that refuses storage keeps the default avatar.
  }
}

/**
 * The avatar of one member.
 * @param {object} props - component props.
 * @param {string} props.name - the member name.
 * @param {string} [props.glyphId] - the pinned glyph id.
 * @param {number} props.size - the avatar's edge length in px.
 * @param {string} [props.className] - extra class names.
 * @returns the avatar element tree.
 */
export function Avatar({ name, glyphId, size = 20, className }) {
  const glyph = GLYPHS.find((candidate) => candidate.id === glyphId) ?? glyphFor(name);
  const hue = hueFor(name);
  return h(
    'span',
    {
      className: className === undefined ? 'atb-avatar' : `atb-avatar ${className}`,
      style: {
        width: `${size}px`,
        height: `${size}px`,
        background: `hsl(${hue} 52% 44%)`,
        borderRadius: `${Math.max(4, Math.round(size * 0.28))}px`,
      },
      'aria-hidden': 'true',
    },
    h(
      'svg',
      {
        viewBox: '0 0 16 16',
        width: Math.round(size * 0.72),
        height: Math.round(size * 0.72),
        fill: 'none',
        stroke: '#ffffff',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      glyph.paths.map((path) => h('path', { key: path, d: path })),
    ),
  );
}
