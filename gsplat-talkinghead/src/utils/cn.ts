/** Minimal classnames combiner — no external dependency needed. */
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
