export function normalizeAgentName(raw) {
  if (!raw) return raw;
  return String(raw).trim();
}
export const AGENT_ALIASES = {};
export function normalizeAllRecords() { return 0; }
