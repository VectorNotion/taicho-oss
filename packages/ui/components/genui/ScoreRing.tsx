'use client';
export function ScoreRing({ score, label }: { score: number | null; label: string }) {
  const value = score ?? 0;
  const angle = (value / 100) * 360;
  return <div data-testid="score-ring" className={`flex items-center gap-3 ${score === null ? 'animate-pulse' : ''}`}><div className="grid h-16 w-16 place-items-center rounded-full transition-all duration-700" style={{ background: `conic-gradient(hsl(var(--primary)) ${angle}deg, hsl(var(--muted)) ${angle}deg)` }}><div className="grid h-12 w-12 place-items-center rounded-full bg-card text-sm font-bold tabular-nums">{score === null ? '–' : value}</div></div><span className="text-sm text-muted-foreground">{label}</span></div>;
}
