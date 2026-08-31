'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  validateGraph,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from '../domain/graph';
import {
  VisualWorkflowBuilder,
  type WorkflowBuilderNode,
  type WorkflowField,
  type WorkflowNodeSpec,
} from '@content-automation/ui/components/workflow/VisualWorkflowBuilder';

export type { GraphDocument, GraphEdge, GraphNode } from '../domain/graph';

type Option = { id: string; name: string };

type FunnelVisualBuilderProps = {
  funnelId: string;
  funnelName: string;
  graph: GraphDocument;
  funnels: Option[];
  /** Live member counts per step id, shown on the nodes. */
  memberCounts?: Record<string, number>;
  /** Per-step sent/reply totals from the event log, shown on touch nodes. */
  nodeMetrics?: Record<string, { sent: number; replies: number }>;
  headerActions?: ReactNode;
  onSave: (doc: GraphDocument) => Promise<void>;
};

const FUNNEL_NODE_SPECS: WorkflowNodeSpec[] = [
  {
    type: 'touch',
    category: 'step',
    label: 'Touch',
    icon: 'email',
    hasInput: true,
    hasOutput: true,
    outputs: [
      { id: 'responded', label: 'They responded', tone: 'primary' },
      { id: 'exhausted', label: 'No response', tone: 'muted' },
    ],
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Personalized ROI report' },
      {
        key: 'instruction',
        label: 'What should the AI write?',
        type: 'textarea',
        required: true,
        placeholder: 'Generate a mini report estimating what our workflows would save them…',
        description: 'The AI writes this touch fresh for every person, from what the workspace knows about them.',
      },
      { key: 'maxAttempts', label: 'Attempts before giving up', type: 'number', min: 1, description: 'Send, wait, and nudge again until they respond — up to this many times.' },
      { key: 'intervalDays', label: 'Days between attempts', type: 'number', min: 1 },
    ],
  },
  {
    type: 'wait',
    category: 'step',
    label: 'Wait',
    icon: 'delay',
    hasInput: true,
    hasOutput: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Cool off' },
      { key: 'days', label: 'Days to wait', type: 'number', required: true, min: 0 },
    ],
  },
  {
    type: 'branch',
    category: 'control',
    label: 'If / else',
    icon: 'branch',
    hasInput: true,
    hasOutput: true,
    outputs: [
      { id: 'yes', label: 'Yes', tone: 'primary' },
      { id: 'no', label: 'No', tone: 'destructive' },
    ],
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Did they sound interested?' },
      {
        key: 'conditionKind',
        label: 'Decide by',
        type: 'select',
        required: true,
        options: [
          { value: 'replied', label: 'They replied' },
          { value: 'positive_reply', label: 'Their reply was positive' },
          { value: 'attribute', label: 'Contact attribute' },
          { value: 'predicate', label: 'Let the AI decide' },
        ],
      },
      { key: 'attributeKey', label: 'Attribute', type: 'text', required: true, placeholder: 'company_size', visibleWhen: { key: 'conditionKind', equals: 'attribute' } },
      { key: 'attributeEquals', label: 'Equals', type: 'text', placeholder: 'enterprise', visibleWhen: { key: 'conditionKind', equals: 'attribute' } },
      {
        key: 'prompt',
        label: 'What should the AI check?',
        type: 'textarea',
        required: true,
        placeholder: 'They sound like an enterprise buyer',
        visibleWhen: { key: 'conditionKind', equals: 'predicate' },
        description: 'The AI answers yes or no from the reply and what the workspace knows; its reasoning is saved and you can overrule it.',
      },
    ],
  },
  {
    type: 'goal',
    category: 'control',
    label: 'Goal',
    icon: 'goal',
    hasInput: true,
    hasOutput: false,
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Booked call' },
      { key: 'outcome', label: 'Outcome', type: 'text', placeholder: 'booked a call' },
    ],
  },
  {
    type: 'route',
    category: 'routing',
    label: 'Send to funnel',
    icon: 'route',
    hasInput: true,
    hasOutput: false,
    fields: [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Long-term nurture' },
      { key: 'toFunnelId', label: 'Target funnel', type: 'select', required: true, placeholder: 'Choose a funnel' },
    ],
  },
];

const FUNNEL_CATEGORIES = [
  { key: 'step', label: 'Steps' },
  { key: 'control', label: 'Controls' },
  { key: 'routing', label: 'Routing' },
];

/** Edge labels doubling as source-handle ids; single-output nodes use `next`. */
const HANDLE_LABELS = ['next', 'yes', 'no', 'responded', 'exhausted'] as const;

function flatConfig(node: GraphNode): Record<string, unknown> {
  if (node.type === 'touch') {
    return {
      name: node.name,
      instruction: node.config.instruction,
      maxAttempts: node.config.repeat.maxAttempts,
      intervalDays: node.config.repeat.intervalDays,
    };
  }
  if (node.type === 'wait') return { name: node.name, days: node.config.days };
  if (node.type === 'branch') {
    const condition = node.config.condition;
    return {
      name: node.name,
      conditionKind: condition.kind === 'event' ? condition.event : condition.kind,
      attributeKey: condition.kind === 'attribute' ? condition.key : '',
      attributeEquals: condition.kind === 'attribute' ? condition.equals : '',
      prompt: condition.kind === 'predicate' ? condition.prompt : '',
    };
  }
  if (node.type === 'goal') return { name: node.name, outcome: node.config.outcome ?? '' };
  return { name: node.name, toFunnelId: node.config.toFunnelId };
}

function graphNodeFromBuilder(node: WorkflowBuilderNode): GraphNode {
  const config = node.data.config;
  const name = String(config.name ?? '').trim();
  if (node.data.specType === 'touch') {
    return {
      id: node.id,
      type: 'touch',
      name,
      config: {
        instruction: String(config.instruction ?? ''),
        repeat: {
          maxAttempts: Math.max(1, Number(config.maxAttempts ?? 1) || 1),
          intervalDays: Math.max(1, Number(config.intervalDays ?? 3) || 3),
        },
      },
    };
  }
  if (node.data.specType === 'wait') {
    return { id: node.id, type: 'wait', name, config: { days: Math.max(0, Number(config.days ?? 1) || 0) } };
  }
  if (node.data.specType === 'branch') {
    const kind = String(config.conditionKind ?? 'replied');
    const condition =
      kind === 'attribute'
        ? { kind: 'attribute' as const, key: String(config.attributeKey ?? ''), equals: String(config.attributeEquals ?? '') }
        : kind === 'predicate'
          ? { kind: 'predicate' as const, prompt: String(config.prompt ?? '') }
          : { kind: 'event' as const, event: (kind === 'positive_reply' ? 'positive_reply' : 'replied') as 'replied' | 'positive_reply' };
    return { id: node.id, type: 'branch', name, config: { condition } };
  }
  if (node.data.specType === 'goal') {
    const outcome = String(config.outcome ?? '').trim();
    return { id: node.id, type: 'goal', name, config: outcome ? { outcome } : {} };
  }
  return { id: node.id, type: 'route', name, config: { toFunnelId: String(config.toFunnelId ?? '') } };
}

function summarize(node: WorkflowBuilderNode, funnels: Option[], members: number | undefined, metrics?: { sent: number; replies: number }): string {
  const config = node.data.config;
  const suffix = members ? ` · ${members} here` : '';
  if (node.data.specType === 'touch') {
    const attempts = Number(config.maxAttempts ?? 1) || 1;
    const cadence = attempts > 1 ? `until they respond · max ${attempts} · every ${Number(config.intervalDays ?? 3) || 3}d` : 'single send';
    const tally = metrics && (metrics.sent > 0 || metrics.replies > 0) ? ` · ${metrics.sent} sent · ${metrics.replies} replied` : '';
    return `${cadence}${suffix}${tally}`;
  }
  if (node.data.specType === 'wait') return `${Number(config.days ?? 0) || 0} days${suffix}`;
  if (node.data.specType === 'branch') {
    const kind = String(config.conditionKind ?? 'replied');
    if (kind === 'attribute') return `${config.attributeKey || 'attribute'} = ${config.attributeEquals || '…'}${suffix}`;
    if (kind === 'predicate') return `AI decides: ${String(config.prompt ?? '').slice(0, 60) || 'describe the check'}${suffix}`;
    return `${kind === 'positive_reply' ? 'reply was positive' : 'they replied'}${suffix}`;
  }
  if (node.data.specType === 'goal') return `${String(config.outcome ?? '') || 'conversion'}${suffix}`;
  const target = funnels.find((funnel) => funnel.id === config.toFunnelId);
  return `${target?.name ?? 'choose a target funnel'}${suffix}`;
}

function defaultConfig(type: string): Record<string, unknown> {
  if (type === 'touch') return { name: '', instruction: '', maxAttempts: 3, intervalDays: 3 };
  if (type === 'wait') return { name: '', days: 3 };
  if (type === 'branch') return { name: '', conditionKind: 'replied', attributeKey: '', attributeEquals: '', prompt: '' };
  if (type === 'goal') return { name: '', outcome: '' };
  return { name: '', toFunnelId: '' };
}

function specLabel(type: string): string {
  return FUNNEL_NODE_SPECS.find((spec) => spec.type === type)?.label ?? type;
}

function requiredConfigurationViolation(node: WorkflowBuilderNode): string | null {
  const config = node.data.config;
  const label = String(config.name ?? '').trim() || specLabel(node.data.specType);
  if (node.data.specType === 'touch') {
    if (!String(config.name ?? '').trim()) return 'A Touch step needs a name before saving.';
    if (!String(config.instruction ?? '').trim()) return `"${label}" needs AI writing instructions before saving.`;
  }
  if (node.data.specType === 'branch') {
    if (config.conditionKind === 'attribute' && !String(config.attributeKey ?? '').trim()) {
      return `"${label}" needs a contact attribute before saving.`;
    }
    if (config.conditionKind === 'predicate' && !String(config.prompt ?? '').trim()) {
      return `"${label}" needs an AI decision prompt before saving.`;
    }
  }
  if (node.data.specType === 'route' && !String(config.toFunnelId ?? '').trim()) {
    return `"${label}" needs a target funnel before saving.`;
  }
  return null;
}

export function FunnelVisualBuilder({
  funnelId,
  funnelName,
  graph,
  funnels,
  memberCounts,
  nodeMetrics,
  headerActions,
  onSave,
}: FunnelVisualBuilderProps) {
  const [nodes, setNodes] = useNodesState<WorkflowBuilderNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const message = 'You have unsaved funnel steps. Leave and discard them?';
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const followLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', followLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', followLink, true);
    };
  }, [dirty]);

  useEffect(() => {
    setNodes(graph.nodes.map((node, index) => ({
      id: node.id,
      type: 'workflow',
      position: graph.layout[node.id] ?? { x: 80 + index * 360, y: node.type === 'branch' ? 240 : 100 },
      data: {
        specType: node.type,
        config: flatConfig(node),
        displayLabel: node.name || specLabel(node.type),
        summary: '',
      },
    })));
    setEdges(graph.edges.map((edge) => ({
      id: `edge-${edge.fromNodeId}-${edge.label}-${edge.toNodeId}`,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      sourceHandle: edge.label === 'next' ? null : edge.label,
      label: edge.label === 'next' ? undefined : edge.label === 'exhausted' ? 'no response' : edge.label === 'responded' ? 'responded' : edge.label,
    })));
    setDirty(false);
  }, [graph, setEdges, setNodes]);

  const displayedNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      displayLabel: String(node.data.config.name ?? '').trim() || specLabel(node.data.specType),
      summary: summarize(node, funnels, memberCounts?.[node.id], nodeMetrics?.[node.id]),
    },
  })), [funnels, memberCounts, nodeMetrics, nodes]);

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowBuilderNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type === 'position' || change.type === 'add' || change.type === 'remove')) {
      setDirty(true);
      if (changes.some((change) => change.type === 'remove' && change.id === selectedId)) setSelectedId(null);
    }
  }, [selectedId, setNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type === 'add' || change.type === 'remove' || change.type === 'replace')) {
      setDirty(true);
    }
  }, [setEdges]);

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) {
      toast.error('A step cannot point at itself — funnels only move forward.');
      return;
    }
    const label = connection.sourceHandle ?? 'next';
    if (!HANDLE_LABELS.includes(label as (typeof HANDLE_LABELS)[number])) return;
    setEdges((current) => addEdge(
      {
        ...connection,
        id: `edge-${connection.source}-${label}-${connection.target}`,
        label: label === 'next' ? undefined : label === 'exhausted' ? 'no response' : label,
      },
      // One arrow per outcome: a new connection from the same handle replaces the old one.
      current.filter((edge) => edge.source !== connection.source || (edge.sourceHandle ?? 'next') !== label),
    ));
    setDirty(true);
  }, [setEdges]);

  const addNode = useCallback((type: string) => {
    const id = crypto.randomUUID();
    const rightmost = nodes.reduce((max, node) => Math.max(max, node.position.x), 0);
    setNodes((current) => [...current, {
      id,
      type: 'workflow',
      position: { x: nodes.length === 0 ? 80 : rightmost + 360, y: type === 'branch' ? 240 : 100 },
      data: { specType: type, config: defaultConfig(type), displayLabel: specLabel(type), summary: '' },
    }]);
    setSelectedId(id);
    setDirty(true);
  }, [nodes, setNodes]);

  const updateConfig = useCallback((nodeId: string, key: string, value: unknown) => {
    setNodes((current) => current.map((node) => (
      node.id === nodeId
        ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } }
        : node
    )));
    setDirty(true);
  }, [setNodes]);

  const removeNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedId(null);
    setDirty(true);
  }, [setEdges, setNodes]);

  const buildDocument = useCallback((): GraphDocument => {
    const graphEdges: GraphEdge[] = edges.map((edge) => ({
      fromNodeId: edge.source,
      toNodeId: edge.target,
      label: (edge.sourceHandle ?? 'next') as GraphEdge['label'],
    }));
    const hasIncoming = new Set(graphEdges.map((edge) => edge.toNodeId));
    const entryCandidates = nodes.filter((node) => !hasIncoming.has(node.id));
    return {
      entryNodeId: entryCandidates.length === 1 ? entryCandidates[0].id : null,
      nodes: nodes.map(graphNodeFromBuilder),
      edges: graphEdges,
      layout: Object.fromEntries(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }])),
    };
  }, [edges, nodes]);

  async function save() {
    if (!dirty || busy) return;
    const configurationViolation = nodes.map(requiredConfigurationViolation).find(Boolean);
    if (configurationViolation) {
      toast.error(configurationViolation);
      return;
    }
    const doc = buildDocument();
    if (!doc.entryNodeId && doc.nodes.length > 0) {
      toast.error('The funnel needs exactly one entry step — one step nothing points at.');
      return;
    }
    const violations = validateGraph(doc);
    if (violations.length > 0) {
      toast.error(violations[0]);
      return;
    }
    setBusy(true);
    try {
      await onSave(doc);
      setDirty(false);
      setSelectedId(null);
      toast.success('Funnel steps saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the funnel steps');
    } finally {
      setBusy(false);
    }
  }

  const resolveOptions = useCallback((_node: WorkflowBuilderNode, field: WorkflowField) => {
    if (field.key === 'toFunnelId') {
      return funnels
        .filter((funnel) => funnel.id !== funnelId)
        .map((funnel) => ({ value: funnel.id, label: funnel.name }));
    }
    return undefined;
  }, [funnelId, funnels]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="funnel-steps-builder">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b bg-background px-4 py-2.5">
        <Button asChild variant="ghost" size="icon" aria-label="Back to funnels">
          <Link href="/cascade">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{funnelName}</h1>
          <p className="text-xs text-muted-foreground">Funnel steps</p>
        </div>
        <Badge variant="outline">forward-only</Badge>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? <Badge variant="outline">Unsaved changes</Badge> : null}
          <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save steps
          </Button>
          {headerActions}
        </div>
      </header>
      <VisualWorkflowBuilder
        nodes={displayedNodes}
        edges={edges}
        specs={FUNNEL_NODE_SPECS}
        categories={FUNNEL_CATEGORIES}
        selectedId={selectedId}
        canEdit={!busy}
        onSelectedIdChange={setSelectedId}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={connect}
        onAddNode={addNode}
        onUpdateConfig={updateConfig}
        onRemoveNode={removeNode}
        resolveFieldOptions={resolveOptions}
        className="min-h-0 flex-1 rounded-none border-0"
      />
    </div>
  );
}
