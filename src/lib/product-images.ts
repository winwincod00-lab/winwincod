export function productImages(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === 'string' && !!value.trim());
    if (typeof parsed === 'string') return parsed.trim() ? [parsed] : [];
    return [];
  } catch { return raw.trim() ? [raw] : []; }
}
