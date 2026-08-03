'use client';

import { motion, AnimatePresence } from 'motion/react';
import { Check, Search, Database, Users, FileText, Tags, Sparkles } from 'lucide-react';

interface ToolProgressProps {
  tool: string;
  status: string;
  message?: string;
}

const toolConfig: Record<string, { icon: typeof Search; label: string }> = {
  searchKnowledge: { icon: Search, label: 'Searching knowledge base' },
  listProjects: { icon: Database, label: 'Listing projects' },
  getProject: { icon: Database, label: 'Loading project' },
  listLeads: { icon: Users, label: 'Listing leads' },
  getLead: { icon: Users, label: 'Loading lead' },
  findLeadContext: { icon: Users, label: 'Searching leads and relationship history' },
  getResearch: { icon: FileText, label: 'Fetching research' },
  listTopics: { icon: Tags, label: 'Loading topics' },
  getTopicMap: { icon: Tags, label: 'Mapping Brain connections' },
  tavilySearch: { icon: Search, label: 'Searching current sources' },
  runLeadIntelligence: { icon: Sparkles, label: 'Running lead intelligence' },
  runOutreachIntelligence: { icon: Sparkles, label: 'Creating outreach artifact' },
};

const defaultConfig = { icon: Sparkles, label: 'Processing' };

export function ToolProgress({ tool, status, message }: ToolProgressProps) {
  const isComplete = status === 'complete';
  const toolKey = tool.replace('Tool', '');
  const config = toolConfig[toolKey] || defaultConfig;
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative my-3 overflow-hidden rounded-xl border border-primary/20 bg-[linear-gradient(110deg,color-mix(in_oklab,var(--primary)_7%,transparent),transparent_45%)] p-3"
      data-component="WORK-04 Tool Progress Card"
    >
      {!isComplete && <motion.span className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-primary/8 to-transparent" animate={{ x: ['-140%', '420%'] }} transition={{ duration: 1.8, ease: 'linear', repeat: Infinity }} />}
      <div className="relative flex items-center gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background/80 text-primary">
          <AnimatePresence mode="wait">
            {isComplete ? <motion.div animate={{ scale: 1 }} initial={{ scale: 0 }} key="check"><Check className="size-4 text-emerald-400" strokeWidth={2} /></motion.div> : <motion.div animate={{ opacity: [0.45, 1, 0.45], scale: [0.94, 1, 0.94] }} key="working" transition={{ duration: 1.4, repeat: Infinity }}><Icon className="size-4" /></motion.div>}
          </AnimatePresence>
        </div>
        <div className="min-w-0 flex-1"><code className="font-mono text-[9px] text-primary/80">{toolKey}</code><p className="mt-0.5 text-xs font-medium text-foreground">{message || config.label}</p></div>
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">{!isComplete && <i className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />}{isComplete ? 'Ready' : 'Live'}</span>
      </div>
      {!isComplete && <div className="relative mt-3 grid grid-cols-[1fr_0.72fr] gap-2"><span className="h-1.5 animate-pulse rounded-full bg-primary/10 motion-reduce:animate-none" /><span className="h-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" /></div>}
    </motion.div>
  );
}
