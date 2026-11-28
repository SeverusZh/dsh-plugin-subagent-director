/** Dictionary template substitution shared by the client surfaces. */
export function withReplacement(template: string, values: Record<string, string | number>): string {
  let text = template;
  for (const [key, value] of Object.entries(values)) text = text.split('{' + key + '}').join(String(value));
  return text;
}
