const PROSPECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function callRecordingProspectUrl(prospectId: string): string | undefined {
  const normalized = prospectId.trim().toLowerCase();
  if (!PROSPECT_ID.test(normalized)) return undefined;
  return `taicho-call-recording://prospect/${normalized}`;
}
