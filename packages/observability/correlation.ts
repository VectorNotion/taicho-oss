const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function safeCorrelationId(
  value: string | null | undefined,
): string | undefined {
  const normalized = value?.trim();
  return normalized && SAFE_ID.test(normalized) ? normalized : undefined;
}
