const LEAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function callRecordingLeadUrl(leadId: string): string | undefined {
  const normalized = leadId.trim().toLowerCase();
  if (!LEAD_ID.test(normalized)) return undefined;
  return `taicho-call-recording://lead/${normalized}`;
}
