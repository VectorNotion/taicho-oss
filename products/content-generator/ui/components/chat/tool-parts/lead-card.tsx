'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Building2, Mail, Linkedin, Search, MessageSquare, Lightbulb, Check, Clock3, NotebookPen, Target } from 'lucide-react';

interface LeadCardProps {
  lead: Record<string, unknown>;
  compact?: boolean;
}

export function LeadCard({ lead, compact = false }: LeadCardProps) {
  const name = lead.name as string;
  const company = lead.company as string | null;
  const title = lead.title as string | null;
  const email = lead.email as string | null;
  const linkedinUrl = lead.linkedinUrl as string | null;
  const status = lead.status as string | null;
  const lastContactedAt = lead.lastContactedAt as string | null;
  const hasResearch = lead.hasResearch as boolean | null;
  const research = lead.research as {
    industry?: string;
    companySummary?: string;
    talkingPoints?: string[];
    outreachAngle?: string;
  } | null;
  const companyInsights = lead.companyInsights as Array<{ category: string; content: string }> | null;
  const outreachMessages = lead.outreachMessages as Array<{
    id: string;
    medium: string;
    subject?: string;
    content: string;
    status?: string;
  }> | null;
  const activities = lead.activities as Array<{ id: string; type: string; title: string; notes?: string; createdAt?: string }> | null;
  const notes = lead.notes as Array<{ id: string; content: string; createdAt?: string }> | null;
  const qualification = lead.qualification as { score?: number; matchedPersonaName?: string; notes?: string } | null;
  const cleanNote = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const statusColors: Record<string, 'default' | 'secondary' | 'outline'> = {
    new: 'secondary',
    contacted: 'default',
    replied: 'default',
    qualified: 'default',
    lost: 'outline',
  };

  if (compact) {
    return (
      <div className="p-3 rounded-lg border hover:bg-muted/50 transition-colors" data-component="DATA-01 Lead Result Card">

        <div className="flex items-center gap-2.5">
          {/* Gradient icon */}
          <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-muted shrink-0">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm truncate">{name}</p>
              {hasResearch && (
                <span title="Has research" className="flex items-center justify-center h-4 w-4 rounded-full bg-green-500/10">
                  <Check className="h-2.5 w-2.5 text-green-500" />
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {company || 'Unknown company'} {title && `· ${title}`}
            </p>
          </div>

          {status && (
            <Badge variant={statusColors[status] || 'secondary'} className="text-xs shrink-0">
              {status}
            </Badge>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="my-2 rounded-lg" data-component="DATA-01 Lead Result Card">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-muted shrink-0">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-base">{name}</CardTitle>
                {hasResearch && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Check className="h-3 w-3" />
                    Researched
                  </Badge>
                )}
                {status && (
                  <Badge variant={statusColors[status] || 'secondary'} className="text-xs">
                    {status}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                {company && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {company}
                  </span>
                )}
                {title && <span>· {title}</span>}
              </div>
              <div className="flex items-center gap-3 mt-2">
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {email}
                  </a>
                )}
                {linkedinUrl && (
                  <a
                    href={linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Linkedin className="h-3.5 w-3.5" />
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
      <CardContent className="space-y-4">
        {(qualification || outreachMessages?.length || activities?.length || notes?.length || lastContactedAt) && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><Target className="size-3" />Qualification</div>
              <p className="mt-2 text-lg font-semibold tabular-nums">{qualification?.score ?? '—'}{qualification?.score !== undefined && <span className="text-xs font-normal text-muted-foreground">/100</span>}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{qualification?.matchedPersonaName ?? 'Not yet qualified'}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><MessageSquare className="size-3" />Touchpoints</div>
              <p className="mt-2 text-lg font-semibold tabular-nums">{(outreachMessages?.length ?? 0) + (activities?.length ?? 0)}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{lastContactedAt ? `Last contact ${new Date(lastContactedAt).toLocaleDateString()}` : 'Workspace history'}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><NotebookPen className="size-3" />Notes</div>
              <p className="mt-2 text-lg font-semibold tabular-nums">{notes?.length ?? 0}</p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">Captain context</p>
            </div>
          </div>
        )}

        {activities && activities.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-muted"><Clock3 className="size-3.5 text-muted-foreground" /></span><span className="text-sm font-medium">Recent relationship activity</span><Badge className="ml-auto text-xs" variant="secondary">{activities.length}</Badge></div>
            <div className="ml-9 space-y-1.5">{activities.slice(0, 3).map((activity) => <div className="rounded-lg border px-3 py-2" key={activity.id}><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-xs font-medium">{activity.title}</p><Badge className="text-[9px]" variant="outline">{activity.type}</Badge></div>{activity.notes && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{activity.notes}</p>}</div>)}</div>
          </div>
        )}

        {notes && notes.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2"><span className="grid size-7 place-items-center rounded-lg bg-muted"><NotebookPen className="size-3.5 text-muted-foreground" /></span><span className="text-sm font-medium">Latest note</span></div>
            <p className="ml-9 rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">{cleanNote(notes[0].content)}</p>
          </div>
        )}

        {/* Research Summary */}
        {research && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                <Search className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">Research</span>
            </div>
            <div className="ml-9">
              {research.industry && (
                <Badge variant="outline" className="text-xs mb-2">
                  {research.industry}
                </Badge>
              )}
              {research.companySummary && (
                <p className="text-sm text-muted-foreground mb-2">{research.companySummary}</p>
              )}
              {research.outreachAngle && (
                <div className="p-2 rounded-lg bg-muted text-sm">
                  <span className="font-medium">Outreach angle:</span> {research.outreachAngle}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Talking Points */}
        {research?.talkingPoints && research.talkingPoints.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                <Lightbulb className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">Talking Points</span>
              <Badge variant="secondary" className="text-xs ml-auto">
                {research.talkingPoints.length}
              </Badge>
            </div>
            <ul className="space-y-1.5 ml-9">
              {research.talkingPoints.map((point, idx) => (
                <li key={idx} className="text-sm text-muted-foreground">
                  • {point}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Company Insights */}
        {companyInsights && companyInsights.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">Company Insights</span>
              <Badge variant="secondary" className="text-xs ml-auto">
                {companyInsights.length}
              </Badge>
            </div>
            <div className="space-y-2 ml-9">
              {companyInsights.slice(0, 3).map((insight, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-muted/50 text-sm">
                  <Badge variant="outline" className="text-xs mb-1.5">
                    {insight.category}
                  </Badge>
                  <p className="text-muted-foreground">{insight.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outreach History */}
        {outreachMessages && outreachMessages.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">Outreach history</span>
              <Badge variant="secondary" className="text-xs ml-auto">
                {outreachMessages.length}
              </Badge>
            </div>
            <div className="space-y-2 ml-9">
              {outreachMessages.slice(0, 3).map((msg) => (
                <div
                  key={msg.id}
                  className="p-2.5 rounded-lg border text-sm"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <Badge variant="outline" className="text-xs">
                      {msg.medium}
                    </Badge>
                    {msg.status && (
                      <Badge
                        variant={msg.status === 'sent' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {msg.status}
                      </Badge>
                    )}
                  </div>
                  {msg.subject && <p className="font-medium text-sm">{msg.subject}</p>}
                  <p className="text-muted-foreground line-clamp-2">{msg.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      </Card>
  );
}
