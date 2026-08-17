/** Field-level diff between two documents in relaxed extJSON form. */

export interface FieldDiff {
  /** Dotted path, arrays as `items[2]`. */
  path: string;
  /** Value on the source side; undefined when the field is target-only. */
  left?: unknown;
  /** Value on the target side; undefined when the field is source-only. */
  right?: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** ExtJSON wrappers ({$oid}, {$date}, ...) compare as leaves, not as objects. */
const isExtJsonLeaf = (v: Record<string, unknown>): boolean => {
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => k.startsWith("$"));
};

const leafEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function walk(a: unknown, b: unknown, path: string, out: FieldDiff[]): void {
  if (leafEqual(a, b)) return;

  const aObj = isPlainObject(a) && !isExtJsonLeaf(a);
  const bObj = isPlainObject(b) && !isExtJsonLeaf(b);

  if (aObj && bObj) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in bo)) out.push({ path: next, left: ao[key] });
      else if (!(key in ao)) out.push({ path: next, right: bo[key] });
      else walk(ao[key], bo[key], next, out);
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const next = `${path}[${i}]`;
      if (i >= b.length) out.push({ path: next, left: a[i] });
      else if (i >= a.length) out.push({ path: next, right: b[i] });
      else walk(a[i], b[i], next, out);
    }
    return;
  }

  // Type mismatch or differing leaves.
  out.push({ path: path || "(document)", left: a, right: b });
}

/** All paths where `left` and `right` differ. Both docs are relaxed extJSON. */
export function diffDocs(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): FieldDiff[] {
  const out: FieldDiff[] = [];
  walk(left, right, "", out);
  return out;
}

/** Compact one-line rendering of a diff value for list rows. */
export function previewValue(v: unknown): string {
  if (v === undefined) return " - ";
  if (isPlainObject(v)) {
    if ("$oid" in v) return `ObjectId(${String(v.$oid)})`;
    if ("$date" in v) {
      const d = v.$date;
      return isPlainObject(d) && "$numberLong" in d
        ? new Date(Number(d.$numberLong)).toISOString()
        : String(d);
    }
  }
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/** Display string for a diff entry's `_id` (extJSON form). */
export function formatId(id: unknown): string {
  return previewValue(id);
}
