'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { formatWorkflowDuration } from './workflow-duration';
import {
  VisualWorkflowBuilder,
  type WorkflowBuilderNode,
  type WorkflowField,
  type WorkflowNodeSpec,
} from './VisualWorkflowBuilder';

type FunnelStep = {
  id: string;
  position: number;
  type: string;
  config: Record<string, unknown>;
};

type FunnelRoute = {
  outcome: string;
  toFunnelId: string;
  toFunnelName: string;
};

type Option = {
  id: string;
  name: string;
};

type FunnelVisualBuilderProps = {
  funnelId: string;
  funnelName: string;
  openEnded: boolean;
  version: number;
  steps: FunnelStep[];
  routes: FunnelRoute[];
  builderLayout: {
    positions?: Record<string, { x: number; y: number }>;
  };
  emails: Option[];
  funnels: Option[];
  headerActions?: ReactNode;
  onReload: () => void | Promise<void>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FUNNEL_NODE_SPECS: WorkflowNodeSpec[] = [
  {
    type: 'email',
    category: 'step',
    label: 'Email',
    icon: 'email',
    hasInput: true,
    hasOutput: true,
    fields: [
      {
        key: 'emailId',
        label: 'Email',
        type: 'select',
        required: true,
        placeholder: 'Choose an email',
        description: 'Emails combine content, a visual design, and delivery settings.',
        action: {
          label: 'Create an email',
          href: '/cascade/templates?mode=content#new-email',
          newTab: true,
        },
      },
    ],
  },
  {
    type: 'delay',
    category: 'step',
    label: 'Delay',
    icon: 'delay',
    hasInput: true,
    hasOutput: true,
    fields: [
      {
        key: 'seconds',
        label: 'Wait',
        type: 'duration',
        required: true,
        min: 0,
        description: 'Choose a human-friendly interval. A month is treated as 30 days.',
      },
    ],
  },
  {
    type: 'branch',
    category: 'control',
    label: 'Branch',
    icon: 'branch',
    hasInput: true,
    hasOutput: true,
    outputs: [
      {
        id: 'true',
        label: 'True output from Branch',
        tone: 'primary',
      },
      {
        id: 'false',
        label: 'False output from Branch',
        tone: 'destructive',
      },
    ],
    fields: [
      {
        key: 'conditionKind',
        label: 'Condition source',
        type: 'select',
        required: true,
        options: [
          { value: 'event', label: 'Engagement event' },
          { value: 'attribute', label: 'Contact attribute' },
        ],
      },
      {
        key: 'eventType',
        label: 'Event',
        type: 'select',
        required: true,
        visibleWhen: { key: 'conditionKind', equals: 'event' },
        options: [
          { value: 'click', label: 'Has clicked' },
          { value: 'open', label: 'Has opened' },
          { value: 'interest', label: 'Has shown interest' },
        ],
      },
      {
        key: 'attributeKey',
        label: 'Attribute',
        type: 'text',
        required: true,
        placeholder: 'plan',
        visibleWhen: { key: 'conditionKind', equals: 'attribute' },
      },
      {
        key: 'attributeEquals',
        label: 'Equals',
        type: 'text',
        placeholder: 'enterprise',
        visibleWhen: { key: 'conditionKind', equals: 'attribute' },
      },
    ],
  },
  {
    type: 'goal',
    category: 'control',
    label: 'Goal',
    icon: 'goal',
    hasInput: true,
    hasOutput: true,
    fields: [
      {
        key: 'outcome',
        label: 'Outcome',
        type: 'select',
        required: true,
        options: [
          { value: 'completed', label: 'Completed' },
          { value: 'interest', label: 'Interest' },
        ],
      },
    ],
  },
  {
    type: 'route',
    category: 'routing',
    label: 'Route',
    icon: 'route',
    hasInput: true,
    hasOutput: false,
    fields: [
      {
        key: 'outcome',
        label: 'On outcome',
        type: 'select',
        required: true,
        options: [
          { value: 'completed', label: 'Completed' },
          { value: 'interest', label: 'Interest' },
        ],
      },
      {
        key: 'toFunnelId',
        label: 'Target funnel',
        type: 'select',
        required: true,
        placeholder: 'Choose a funnel',
      },
    ],
  },
];

const FUNNEL_CATEGORIES = [
  { key: 'step', label: 'Steps' },
  { key: 'control', label: 'Controls' },
  { key: 'routing', label: 'Routing' },
];

function stepConfigForBuilder(step: FunnelStep): Record<string, unknown> {
  if (step.type === 'branch') {
    const condition = step.config.condition as Record<string, unknown> | undefined;
    return {
      conditionKind: condition?.kind ?? 'event',
      eventType: condition?.type ?? 'click',
      attributeKey: condition?.key ?? '',
      attributeEquals: condition?.equals ?? '',
      thenPosition: step.config.thenPosition ?? step.position + 1,
      elsePosition: step.config.elsePosition ?? step.position + 1,
    };
  }
  if (step.type === 'goal') {
    return { outcome: step.config.outcome ?? 'completed' };
  }
  return { ...step.config };
}
function stepSummary(step: FunnelStep): string {
  if (step.type === 'email') {
    return step.config.emailId
      ? 'selected email'
      : String(step.config.subject ?? 'set subject');
  }
  if (step.type === 'delay') {
    return formatWorkflowDuration(step.config.seconds);
  }
  if (step.type === 'branch') {
    return `step ${step.config.thenPosition ?? '?'} / step ${step.config.elsePosition ?? '?'}`;
  }
  if (step.type === 'goal') {
    return String(step.config.outcome ?? 'completed');
  }
  return step.type;
}

function nodesFromDetail(
  steps: FunnelStep[],
  routes: FunnelRoute[],
  builderLayout: FunnelVisualBuilderProps['builderLayout'],
): WorkflowBuilderNode[] {
  const stepNodes: WorkflowBuilderNode[] = steps.map((step, index) => ({
    id: step.id,
    type: 'workflow',
    position: builderLayout.positions?.[step.id] ?? {
      x: 80 + index * 250,
      y: step.type === 'branch' ? 180 : 100,
    },
    data: {
      specType: step.type,
      config: stepConfigForBuilder(step),
      displayLabel: `Step ${step.position} · ${step.type[0].toUpperCase()}${step.type.slice(1)}`,
      summary: stepSummary(step),
    },
  }));
  const routeX = 80 + Math.max(steps.length, 1) * 250;
  const routeNodes: WorkflowBuilderNode[] = routes.map((route, index) => ({
    id: `route-${route.outcome}`,
    type: 'workflow',
    position: builderLayout.positions?.[`route:${route.outcome}`]
      ?? { x: routeX, y: 40 + index * 180 },
    data: {
      specType: 'route',
      config: {
        outcome: route.outcome,
        toFunnelId: route.toFunnelId,
      },
      displayLabel: `Route · ${route.outcome}`,
      summary: route.toFunnelName,
    },
  }));
  return [...stepNodes, ...routeNodes];
}

function edgesFromDetail(
  steps: FunnelStep[],
  routes: FunnelRoute[],
): Edge[] {
  const stepByPosition = new Map(steps.map((step) => [step.position, step]));
  const edges: Edge[] = [];
  for (const step of steps) {
    if (step.type === 'branch') {
      const truthy = stepByPosition.get(Number(step.config.thenPosition));
      const falsy = stepByPosition.get(Number(step.config.elsePosition));
      if (truthy) {
        edges.push({
          id: `edge-${step.id}-true-${truthy.id}`,
          source: step.id,
          target: truthy.id,
          sourceHandle: 'true',
        });
      }
      if (falsy) {
        edges.push({
          id: `edge-${step.id}-false-${falsy.id}`,
          source: step.id,
          target: falsy.id,
          sourceHandle: 'false',
        });
      }
      continue;
    }
    if (step.type === 'goal') {
      const outcome = String(step.config.outcome ?? 'completed');
      if (routes.some((route) => route.outcome === outcome)) {
        edges.push({
          id: `edge-${step.id}-route-${outcome}`,
          source: step.id,
          target: `route-${outcome}`,
        });
      }
      continue;
    }
    const next = stepByPosition.get(step.position + 1);
    if (next) {
      edges.push({
        id: `edge-${step.id}-${next.id}`,
        source: step.id,
        target: next.id,
      });
    }
  }
  return edges;
}

function defaultNodeConfig(type: string): Record<string, unknown> {
  if (type === 'email') return { emailId: '' };
  if (type === 'delay') return { seconds: 86400 };
  if (type === 'branch') {
    return {
      conditionKind: 'event',
      eventType: 'click',
      thenPosition: 1,
      elsePosition: 1,
    };
  }
  return { outcome: 'completed' };
}

function stepConfigPayload(node: WorkflowBuilderNode): Record<string, unknown> {
  const config = node.data.config;
  if (node.data.specType === 'email') {
    return { emailId: config.emailId };
  }
  if (node.data.specType === 'delay') {
    return { seconds: Number(config.seconds) };
  }
  if (node.data.specType === 'branch') {
    return {
      conditionKind: config.conditionKind,
      eventType: config.eventType,
      attributeKey: config.attributeKey,
      attributeEquals: config.attributeEquals,
      thenPosition: Number(config.thenPosition),
      elsePosition: Number(config.elsePosition),
    };
  }
  return { outcome: config.outcome };
}

function orderedSteps(nodes: WorkflowBuilderNode[]): WorkflowBuilderNode[] {
  return nodes
    .filter((node) => node.data.specType !== 'route')
    .sort((left, right) => (
      left.position.x - right.position.x
      || left.position.y - right.position.y
      || left.id.localeCompare(right.id)
    ));
}

function structuralEdges(
  nodes: WorkflowBuilderNode[],
  currentEdges: Edge[],
): Edge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sequence = orderedSteps(nodes);
  const preservedBranches = currentEdges.filter((edge) => (
    byId.get(edge.source)?.data.specType === 'branch'
    && byId.has(edge.target)
    && byId.get(edge.target)?.data.specType !== 'route'
  ));
  const edges = [...preservedBranches];
  for (const [index, node] of sequence.entries()) {
    if (node.data.specType === 'email' || node.data.specType === 'delay') {
      const next = sequence[index + 1];
      if (next) {
        edges.push({
          id: `edge-${node.id}-default-${next.id}`,
          source: node.id,
          target: next.id,
        });
      }
    }
    if (node.data.specType === 'goal') {
      const outcome = String(node.data.config.outcome ?? 'completed');
      const route = nodes.find((candidate) => (
        candidate.data.specType === 'route'
        && candidate.data.config.outcome === outcome
      ));
      if (route) {
        edges.push({
          id: `edge-${node.id}-route-${outcome}`,
          source: node.id,
          target: route.id,
        });
      }
    }
  }
  return edges;
}

export function FunnelVisualBuilder({
  funnelId,
  funnelName,
  openEnded,
  version,
  steps,
  routes,
  builderLayout,
  emails,
  funnels,
  headerActions,
  onReload,
}: FunnelVisualBuilderProps) {
  const [nodes, setNodes] = useNodesState<WorkflowBuilderNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const draftCounter = useRef(0);

  useEffect(() => {
    setNodes(nodesFromDetail(steps, routes, builderLayout));
    setEdges(edgesFromDetail(steps, routes));
  }, [builderLayout, routes, setEdges, setNodes, steps]);

  const orderedStepNodes = useMemo(
    () => orderedSteps(nodes),
    [nodes],
  );
  const displayedNodes = useMemo(() => {
    const order = new Map(
      orderedStepNodes.map((node, index) => [node.id, index + 1]),
    );
    return nodes.map((node) => {
      if (node.data.specType === 'route') {
        const target = funnels.find(
          (funnel) => funnel.id === node.data.config.toFunnelId,
        );
        return {
          ...node,
          data: {
            ...node.data,
            displayLabel: `Route · ${node.data.config.outcome ?? 'choose outcome'}`,
            summary: target?.name ?? 'choose a target funnel',
          },
        };
      }
      const step = order.get(node.id);
      const config = node.data.config;
      let summary = node.data.specType;
      if (node.data.specType === 'email') {
        summary = emails.find((email) => email.id === config.emailId)?.name
          ?? 'choose an email';
      } else if (node.data.specType === 'delay') {
        summary = formatWorkflowDuration(config.seconds);
      } else if (node.data.specType === 'branch') {
        summary = 'connect true and false outcomes';
      } else if (node.data.specType === 'goal') {
        summary = String(config.outcome ?? 'completed');
      }
      return {
        ...node,
        data: {
          ...node.data,
          displayLabel: `Step ${step} · ${node.data.specType[0].toUpperCase()}${node.data.specType.slice(1)}`,
          summary,
        },
      };
    });
  }, [emails, funnels, nodes, orderedStepNodes]);

  const updateConfig = useCallback((
    nodeId: string,
    key: string,
    value: unknown,
  ) => {
    const nextNodes = nodes.map((node) => (
      node.id === nodeId
        ? {
          ...node,
          data: {
            ...node.data,
            config: { ...node.data.config, [key]: value },
          },
        }
        : node
    ));
    setNodes(nextNodes);
    setEdges((current) => structuralEdges(nextNodes, current));
    setDirty(true);
  }, [nodes, setEdges, setNodes]);

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) {
      toast.error('A funnel node cannot connect to itself');
      return;
    }
    const sourceNode = nodes.find((node) => node.id === connection.source);
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) return;
    if (
      sourceNode.data.specType !== 'branch'
      && sourceNode.data.specType !== 'goal'
      && targetNode.data.specType !== 'route'
    ) {
      const ordered = [...orderedStepNodes];
      const targetIndex = ordered.findIndex(
        (node) => node.id === targetNode.id,
      );
      if (targetIndex >= 0) ordered.splice(targetIndex, 1);
      const sourceIndex = ordered.findIndex(
        (node) => node.id === sourceNode.id,
      );
      ordered.splice(sourceIndex + 1, 0, targetNode);
      const reordered = nodes.map((node) => {
        const index = ordered.findIndex((candidate) => candidate.id === node.id);
        return index < 0
          ? node
          : {
            ...node,
            position: { ...node.position, x: 80 + index * 250 },
          };
      });
      setNodes(reordered);
      setEdges((current) => structuralEdges(reordered, current));
    } else if (
      sourceNode.data.specType === 'branch'
      && targetNode.data.specType !== 'route'
    ) {
      const withoutReplaced = edges.filter((edge) => (
        edge.source !== connection.source
        || edge.sourceHandle !== connection.sourceHandle
      ));
      const connected = addEdge({
        ...connection,
        id: `edge-${connection.source}-${connection.sourceHandle ?? 'default'}-${connection.target}`,
      }, withoutReplaced);
      setEdges(structuralEdges(nodes, connected));
    } else if (
      sourceNode.data.specType === 'goal'
      && targetNode.data.specType === 'route'
    ) {
      const nextNodes = nodes.map((node) => (
        node.id === sourceNode.id
          ? {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                outcome: targetNode.data.config.outcome,
              },
            },
          }
          : node
      ));
      setNodes(nextNodes);
      setEdges((current) => structuralEdges(nextNodes, current));
    } else {
      toast.error('That connection is not valid for a Funnel workflow');
      return;
    }
    setDirty(true);
  }, [edges, nodes, orderedStepNodes, setEdges, setNodes]);

  function addNode(type: string) {
    if (type === 'route') {
      const outcome = ['completed', 'interest'].find(
        (candidate) => !nodes.some((node) => (
          node.data.specType === 'route'
          && node.data.config.outcome === candidate
        )),
      );
      if (!outcome) {
        toast.error('Both funnel outcomes already have routes');
        return;
      }
      draftCounter.current += 1;
      const id = `route-draft-${outcome}-${draftCounter.current}`;
      const routeNodes = nodes.filter(
        (node) => node.data.specType === 'route',
      );
      const nextNode: WorkflowBuilderNode = {
        id,
        type: 'workflow',
        position: {
          x: 80 + Math.max(orderedStepNodes.length, 1) * 250,
          y: 40 + routeNodes.length * 180,
        },
        data: {
          specType: 'route',
          config: { outcome, toFunnelId: '' },
          displayLabel: `Route · ${outcome}`,
          summary: 'choose a target funnel',
        },
      };
      const nextNodes = [...nodes, nextNode];
      setNodes(nextNodes);
      setEdges((current) => structuralEdges(nextNodes, current));
      setSelectedId(id);
      setDirty(true);
      return;
    }

    const selectedIndex = orderedStepNodes.findIndex(
      (node) => node.id === selectedId,
    );
    const selected = selectedIndex >= 0
      ? orderedStepNodes[selectedIndex]
      : null;
    const afterSelected = selected
      ? orderedStepNodes[selectedIndex + 1]
      : null;
    const last = orderedStepNodes.at(-1);
    const x = selected
      ? afterSelected
        ? (selected.position.x + afterSelected.position.x) / 2
        : selected.position.x + 250
      : last
        ? last.position.x + 250
        : 80;
    draftCounter.current += 1;
    const id = `draft-${funnelId}-${draftCounter.current}`;
    const nextNode: WorkflowBuilderNode = {
      id,
      type: 'workflow',
      position: { x, y: type === 'branch' ? 180 : 100 },
      data: {
        specType: type,
        config: defaultNodeConfig(type),
        displayLabel: `New ${type}`,
        summary: 'configure this node',
      },
    };
    const nextNodes = [...nodes, nextNode];
    setNodes(nextNodes);
    setEdges((current) => structuralEdges(nextNodes, current));
    setSelectedId(id);
    setDirty(true);
  }

  function removeNode(nodeId: string) {
    const nextNodes = nodes.filter((node) => node.id !== nodeId);
    const attachedRemoved = edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    setNodes(nextNodes);
    setEdges(structuralEdges(nextNodes, attachedRemoved));
    setSelectedId(null);
    setDirty(true);
  }

  async function save() {
    if (!dirty) return;
    const stepPositionById = new Map(
      orderedStepNodes.map((node, index) => [node.id, index + 1]),
    );
    const serializedSteps = [];
    for (const node of orderedStepNodes) {
      let configuredNode = node;
      if (node.data.specType === 'branch') {
        const outgoing = edges.filter((edge) => edge.source === node.id);
        const truthy = outgoing.find((edge) => edge.sourceHandle === 'true');
        const falsy = outgoing.find((edge) => edge.sourceHandle === 'false');
        const thenPosition = truthy
          ? stepPositionById.get(truthy.target)
          : undefined;
        const elsePosition = falsy
          ? stepPositionById.get(falsy.target)
          : undefined;
        if (!thenPosition || !elsePosition) {
          toast.error('Branch: connect both true and false outcomes');
          return;
        }
        configuredNode = {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              thenPosition,
              elsePosition,
            },
          },
        };
      }
      serializedSteps.push({
        clientId: node.id,
        ...(UUID.test(node.id) ? { id: node.id } : {}),
        type: node.data.specType,
        config: stepConfigPayload(configuredNode),
        position: node.position,
      });
    }
    const routeNodes = nodes.filter(
      (node) => node.data.specType === 'route',
    );
    const outcomes = new Set<string>();
    const serializedRoutes = [];
    for (const node of routeNodes) {
      const outcome = String(node.data.config.outcome ?? '');
      const toFunnelId = String(node.data.config.toFunnelId ?? '');
      if (outcome !== 'completed' && outcome !== 'interest') {
        toast.error('Route: choose an outcome');
        return;
      }
      if (!toFunnelId) {
        toast.error(`Route ${outcome}: choose a target funnel`);
        return;
      }
      if (outcomes.has(outcome)) {
        toast.error(`A route for ${outcome} already exists`);
        return;
      }
      outcomes.add(outcome);
      serializedRoutes.push({
        outcome,
        toFunnelId,
        position: node.position,
      });
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/cascade/funnels/${funnelId}/workflow`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version,
            steps: serializedSteps,
            routes: serializedRoutes,
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? 'Could not save the funnel workflow');
        return;
      }
      setDirty(false);
      setSelectedId(null);
      toast.success('Funnel workflow saved');
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  const handleNodesChange = useCallback((
    changes: NodeChange<WorkflowBuilderNode>[],
  ) => {
    const nextNodes = applyNodeChanges(changes, nodes);
    setNodes(nextNodes);
    const changedStructure = changes.some((change) => (
      change.type === 'position'
      || change.type === 'add'
      || change.type === 'remove'
    ));
    if (changedStructure) {
      const shouldRebuildEdges = changes.some((change) => (
        change.type === 'add'
        || change.type === 'remove'
        || (change.type === 'position' && !change.dragging)
      ));
      if (shouldRebuildEdges) {
        setEdges((current) => structuralEdges(nextNodes, current));
      }
      if (changes.some((change) => (
        change.type === 'remove' && change.id === selectedId
      ))) {
        setSelectedId(null);
      }
      setDirty(true);
    }
  }, [nodes, selectedId, setEdges, setNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const nextEdges = applyEdgeChanges(changes, edges);
    setEdges(nextEdges);
    if (changes.some((change) => (
      change.type === 'add'
      || change.type === 'remove'
      || change.type === 'replace'
    ))) {
      setDirty(true);
    }
  }, [edges, setEdges]);

  const resolveOptions = useCallback((
    _node: WorkflowBuilderNode,
    field: WorkflowField,
  ) => {
    if (field.key === 'emailId') {
      return emails.map((email) => ({ value: email.id, label: email.name }));
    }
    if (field.key === 'toFunnelId') {
      return funnels
        .filter((funnel) => funnel.id !== funnelId)
        .map((funnel) => ({ value: funnel.id, label: funnel.name }));
    }
    return undefined;
  }, [emails, funnelId, funnels]);

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="funnel-step-workflow"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b bg-background px-4 py-2.5">
        <Button asChild variant="ghost" size="icon" aria-label="Back to funnels">
          <Link href="/cascade">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{funnelName}</h1>
          <p className="text-xs text-muted-foreground">Funnel workflow</p>
        </div>
        <Badge variant="outline">
          {openEnded ? 'open-ended queue' : 'sequence'}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Badge variant="outline">Unsaved changes</Badge>
          )}
          <Button
            size="sm"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Save className="h-4 w-4" />}
            Save workflow
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
