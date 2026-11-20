// First match wins: Edge and Opera also say "Chrome", Chrome also says "Safari", Android also says "Linux"
// and iPhone also says "Mac OS X".
const BROWSERS: [string, string][] = [['Edg/', 'Edge'], ['OPR/', 'Opera'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']];
const SYSTEMS: [string, string][] = [['Android', 'Android'], ['iPhone', 'iOS'], ['iPad', 'iPadOS'], ['Windows', 'Windows'], ['Mac OS X', 'macOS'], ['Linux', 'Linux']];
const find = (list: [string, string][], userAgent: string) => list.find(([token]) => userAgent.includes(token))?.[1];

// "Mozilla/5.0 (Windows NT 10.0; …) … Chrome/… Safari/…" → "Chrome · Windows"; '' when nothing is recognised.
export function describeDevice(userAgent: string): string {
  return [find(BROWSERS, userAgent), find(SYSTEMS, userAgent)].filter(Boolean).join(' · ');
}
