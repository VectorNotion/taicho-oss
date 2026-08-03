'use client';

import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  Box,
  CircleAlert,
  CircleCheck,
  Clock3,
  Flag,
  GitBranch,
  Mail,
  PackageCheck,
  Route,
  Search,
  Trash2,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  durationFromSeconds,
  durationUnitSeconds,
  WORKFLOW_DURATION_UNITS,
  type WorkflowDurationUnit,
} from './workflow-duration';
type NodeArtifactState = {
  accepts: Array<{ kind: string; label: string }>;
  produces: Array<{ kind: string; label: string }>;
  matched: Array<{ kind: string; label: string; sourceLabel: string }>;
  missing: unknown[];
};
import { runtimeStatusLabel, runtimeStatusVariant } from './runtime-ui';

export type WorkflowRuntime = {
  state?: string;
  summary?: string;
  outputPreview?: string | null;
  reason?: string;
  text?: string;
};

export type WorkflowField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'agent' | 'duration';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  min?: number;
  visibleWhen?: { key: string; equals: unknown };
  description?: string;
  action?: { label: string; href: string; newTab?: boolean };
  advanced?: boolean;
};

export type WorkflowHandle = {
  id: string;
  label: string;
  tone?: 'primary' | 'destructive' | 'muted';
};

export type WorkflowNodeSpec = {
  type: string;
  category: string;
  label: string;
  fields: WorkflowField[];
  hasInput: boolean;
  hasOutput: boolean;
  icon?: WorkflowIconName;
  outputs?: WorkflowHandle[];
};

export type WorkflowIconName =
  | 'automation'
  | 'branch'
  | 'delay'
  | 'email'
  | 'goal'
  | 'operation'
  | 'output'
  | 'route'
  | 'squad'
  | 'trigger';

export type WorkflowBuilderNodeData = {
  specType: string;
  config: Record<string, unknown>;
  displayLabel?: string;
  summary?: string;
  runtime?: WorkflowRuntime;
  artifactState?: NodeArtifactState;
  onSelect?: (id: string) => void;
};

export type WorkflowBuilderNode = Node<WorkflowBuilderNodeData>;

export type WorkflowPaletteCategory = {
  key: string;
  label: string;
};

type VisualWorkflowBuilderProps = {
  nodes: WorkflowBuilderNode[];
  edges: Edge[];
  specs: WorkflowNodeSpec[];
  categories: WorkflowPaletteCategory[];
  selectedId: string | null;
  canEdit: boolean;
  onSelectedIdChange: (id: string | null) => void;
  onNodesChange: (changes: NodeChange<WorkflowBuilderNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onAddNode: (specType: string) => void;
  onUpdateConfig: (nodeId: string, key: string, value: unknown) => void;
  onRemoveNode: (nodeId: string) => void;
  resolveFieldOptions?: (
    node: WorkflowBuilderNode,
    field: WorkflowField,
  ) => Array<{ value: string; label: string }> | undefined;
  templateHint?: string;
  renderNodePanel?: (node: WorkflowBuilderNode) => ReactNode;
  rightDrawer?: ReactNode;
  className?: string;
};

const ICONS: Record<WorkflowIconName, ComponentType<{ className?: string }>> = {
  automation: Workflow,
  branch: GitBranch,
  delay: Clock3,
  email: Mail,
  goal: Flag,
  operation: Search,
  output: PackageCheck,
  route: Route,
  squad: Users,
  trigger: Zap,
};

function iconNameForSpec(spec: WorkflowNodeSpec): WorkflowIconName {
  if (spec.icon) return spec.icon;
  if (spec.category === 'trigger') return 'trigger';
  if (spec.category === 'squad') return 'squad';
  if (spec.category === 'operation') return 'operation';
  if (spec.category === 'control' && spec.type.includes('branch')) return 'branch';
  if (spec.category === 'control' && spec.type.includes('delay')) return 'delay';
  if (spec.category === 'action') return 'route';
  if (spec.category === 'output') return 'output';
  return 'automation';
}

function NodeIcon({ spec }: { spec: WorkflowNodeSpec }) {
  const Icon = ICONS[iconNameForSpec(spec)];
  return <Icon className="h-4 w-4" />;
}

function handleToneClass(tone: WorkflowHandle['tone']) {
  if (tone === 'primary') return '!border-primary !bg-primary';
  if (tone === 'destructive') return '!border-destructive !bg-destructive';
  return '!border-border !bg-muted';
}

function WorkflowNodeCard({
  id,
  data,
  selected,
}: NodeProps<WorkflowBuilderNode>) {
  const spec = (data as WorkflowBuilderNodeData & { spec?: WorkflowNodeSpec }).spec;
  if (!spec) return null;
  const runtime = data.runtime;
  const running = runtime?.state === 'running';
  const done = runtime?.state === 'done' || runtime?.state === 'succeeded';
  const failed = runtime?.state === 'failed';
  const artifactState = data.artifactState;
  const missingData = Boolean(artifactState?.missing.length);
  const outputs = spec.outputs ?? (
    spec.hasOutput
      ? [{ id: 'default', label: `Output from ${spec.label}`, tone: 'muted' as const }]
      : []
  );

  return (
    <div
      data-testid={`workflow-node-${id}`}
      data-node-type={spec.type}
      data-step-type={spec.type}
      data-data-status={missingData ? 'missing' : artifactState?.accepts.length ? 'ready' : artifactState?.produces.length ? 'provides' : 'none'}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect?.(id);
      }}
      className={`min-w-[230px] max-w-[290px] rounded-lg border bg-card px-3.5 py-2.5 shadow-sm transition-colors ${
        running
          ? 'animate-pulse border-primary ring-1 ring-primary/30'
          : failed || missingData
            ? 'border-destructive ring-1 ring-destructive/30'
            : selected
              ? 'border-ring ring-1 ring-ring/30'
              : 'border-border'
      }`}
    >
      {spec.hasInput && (
        <Handle
          aria-label={`Input for ${spec.label}`}
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !border-border !bg-muted"
        />
      )}
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-muted text-muted-foreground">
          <NodeIcon spec={spec} />
        </span>
        <span className="text-[13px] font-semibold">
          {data.displayLabel ?? spec.label}
        </span>
        {runtime?.state && (
          <Badge
            className="ml-auto max-w-28 truncate"
            variant={runtimeStatusVariant(done ? 'succeeded' : runtime.state)}
          >
            {running
              ? 'running'
              : done
                ? 'succeeded'
                : runtimeStatusLabel(runtime.state ?? '')}
          </Badge>
        )}
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {data.summary ?? spec.label}
      </div>
      {artifactState && (artifactState.accepts.length > 0 || artifactState.produces.length > 0) && (
        <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2.5">
          {artifactState.accepts.map((requirement) => {
            const source = artifactState.matched.find((artifact) => artifact.kind === requirement.kind);
            return (
              <div
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${source ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : 'border-destructive/40 bg-destructive/[0.08]'}`}
                key={`requires-${requirement.kind}`}
              >
                {source
                  ? <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  : <CircleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-semibold ${source ? 'text-foreground' : 'text-destructive'}`}>
                    {requirement.label}{source ? '' : ' required'}
                  </p>
                  <p className="truncate text-[9px] text-muted-foreground">
                    {source ? `From ${source.sourceLabel}` : `No upstream ${requirement.label} source`}
                  </p>
                </div>
              </div>
            );
          })}
          {artifactState.produces.map((artifact) => (
            <div className="flex items-center gap-2 px-2 py-1 text-[9px] text-muted-foreground" key={`provides-${artifact.kind}`}>
              <Box className="h-3 w-3 shrink-0" />
              <span>Provides <strong className="font-medium text-foreground">{artifact.label}</strong></span>
            </div>
          ))}
        </div>
      )}
      {running && (runtime?.reason || runtime?.text) && (
        <div className="mt-2 max-h-16 overflow-hidden rounded-md border bg-muted p-1.5 font-mono text-[10px] leading-snug text-muted-foreground">
          {(runtime.text || runtime.reason || '').slice(-160)}▊
        </div>
      )}
      {outputs.map((output, index) => (
        <Handle
          aria-label={output.label}
          id={output.id === 'default' ? undefined : output.id}
          key={output.id}
          type="source"
          position={Position.Right}
          style={outputs.length > 1 ? { top: `${38 + index * 34}%` } : undefined}
          className={`!h-2.5 !w-2.5 ${handleToneClass(output.tone)}`}
        />
      ))}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNodeCard };

export function VisualWorkflowEditorSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="workflow-editor-skeleton"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <Skeleton className="h-8 w-8" />
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-5 w-20" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-24" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 space-y-5 border-r p-3">
          {Array.from({ length: 3 }).map((_, category) => (
            <div className="grid gap-2" key={category}>
              <Skeleton className="h-3 w-16" />
              {Array.from({ length: category === 0 ? 2 : 1 }).map(
                (__, item) => (
                  <Skeleton className="h-8 w-full" key={item} />
                ),
              )}
            </div>
          ))}
        </aside>
        <div className="relative min-w-0 flex-1 overflow-hidden p-8">
          <div className="flex items-center gap-12 pt-16">
            <Skeleton className="h-20 w-48" />
            <Skeleton className="h-20 w-48" />
            <Skeleton className="h-20 w-48" />
          </div>
          <Skeleton className="absolute bottom-4 right-4 h-32 w-48" />
        </div>
      </div>
    </div>
  );
}

export function VisualWorkflowBuilder({
  nodes,
  edges,
  specs,
  categories,
  selectedId,
  canEdit,
  onSelectedIdChange,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onAddNode,
  onUpdateConfig,
  onRemoveNode,
  resolveFieldOptions,
  templateHint,
  renderNodePanel,
  rightDrawer,
  className = 'min-h-[560px]',
}: VisualWorkflowBuilderProps) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [durationUnits, setDurationUnits] = useState<
    Record<string, WorkflowDurationUnit>
  >({});
  const specsByType = useMemo(
    () => new Map(specs.map((spec) => [spec.type, spec])),
    [specs],
  );
  const renderedNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      type: 'workflow',
      selected: node.id === selectedId,
      data: {
        ...node.data,
        spec: specsByType.get(node.data.specType),
        onSelect: onSelectedIdChange,
      },
    })),
    [nodes, onSelectedIdChange, selectedId, specsByType],
  );
  const selected = nodes.find((node) => node.id === selectedId);
  const selectedSpec = selected
    ? specsByType.get(selected.data.specType)
    : undefined;
  const extraPanel = selected && selectedSpec ? renderNodePanel?.(selected) ?? null : null;

  function renderField(field: WorkflowField) {
    if (!selected) return null;
    const value = selected.data.config[field.key] ?? '';
    const fieldId = `workflow-node-${selected.id}-${field.key}`;
    const options = resolveFieldOptions?.(selected, field) ?? field.options;

    if (field.type === 'duration') {
      const persisted = durationFromSeconds(value);
      const unit = durationUnits[fieldId] ?? persisted.unit;
      const unitSeconds = durationUnitSeconds(unit);
      const seconds = Number(value);
      const amount = Number.isFinite(seconds)
        ? Number((seconds / unitSeconds).toFixed(4))
        : 0;
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_132px] gap-2">
          <Input
            id={fieldId}
            disabled={!canEdit}
            type="number"
            min={0}
            step="any"
            className="text-xs"
            value={String(amount)}
            onChange={(event) => {
              const nextAmount = Number(event.target.value);
              onUpdateConfig(
                selected.id,
                field.key,
                Number.isFinite(nextAmount) ? nextAmount * unitSeconds : 0,
              );
            }}
          />
          <Select
            disabled={!canEdit}
            value={unit}
            onValueChange={(next: WorkflowDurationUnit) => {
              setDurationUnits((current) => ({
                ...current,
                [fieldId]: next,
              }));
              onUpdateConfig(
                selected.id,
                field.key,
                amount * durationUnitSeconds(next),
              );
            }}
          >
            <SelectTrigger aria-label={`${field.label} unit`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_DURATION_UNITS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    if (field.type === 'select' || field.type === 'agent') {
      return (
        <Select
          disabled={!canEdit}
          value={String(value)}
          onValueChange={(next) => onUpdateConfig(selected.id, field.key, next)}
        >
          <SelectTrigger id={fieldId} className="w-full">
            <SelectValue placeholder={field.placeholder ?? 'Choose an option'} />
          </SelectTrigger>
          <SelectContent>
            {options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (field.type === 'textarea') {
      return (
        <Textarea
          id={fieldId}
          disabled={!canEdit}
          rows={4}
          className="font-mono text-xs"
          placeholder={field.placeholder}
          value={String(value)}
          onChange={(event) => onUpdateConfig(
            selected.id,
            field.key,
            event.target.value,
          )}
        />
      );
    }
    return (
      <Input
        id={fieldId}
        disabled={!canEdit}
        type={field.type === 'number' ? 'number' : 'text'}
        min={field.min}
        className="text-xs"
        placeholder={field.placeholder}
        value={String(value)}
        onChange={(event) => onUpdateConfig(
          selected.id,
          field.key,
          field.type === 'number'
            ? Number(event.target.value)
            : event.target.value,
        )}
      />
    );
  }

  function renderFieldBlock(field: WorkflowField) {
    if (!selected) return null;
    return (
      <div className="grid gap-2" key={field.key}>
        <Label htmlFor={`workflow-node-${selected.id}-${field.key}`}>
          {field.label}
          {field.required && ' *'}
        </Label>
        {renderField(field)}
        {templateHint && (field.type === 'text' || field.type === 'textarea') && (
          <p className="text-xs text-muted-foreground">{templateHint}</p>
        )}
        {field.description && (
          <p className="text-xs leading-relaxed text-muted-foreground">{field.description}</p>
        )}
        {field.action && (
          <Button asChild variant="link" size="sm" className="h-auto justify-start p-0 text-xs">
            <Link href={field.action.href} target={field.action.newTab ? '_blank' : undefined}>
              {field.action.label}
            </Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`flex min-h-0 overflow-hidden rounded-lg border bg-background ${className}`}>
        {categories.length > 0 && (
          <aside className="w-48 shrink-0 space-y-5 overflow-y-auto border-r bg-background p-3">
            {categories.map((category) => {
              const categorySpecs = specs.filter(
                (spec) => spec.category === category.key,
              );
              if (categorySpecs.length === 0) return null;
              return (
                <div key={category.key}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {category.label}
                  </div>
                  <div className="space-y-1.5">
                    {categorySpecs.map((spec) => (
                      <Button
                        key={spec.type}
                        aria-label={`Add ${spec.label} step`}
                        disabled={!canEdit}
                        onClick={() => onAddNode(spec.type)}
                        variant="outline"
                        size="sm"
                        className="w-full justify-start"
                      >
                        <NodeIcon spec={spec} />
                        {spec.label}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </aside>
        )}

        <div className="relative min-w-0 flex-1" data-testid="workflow-canvas">
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => onSelectedIdChange(node.id)}
            onPaneClick={() => onSelectedIdChange(null)}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            edgesReconnectable={canEdit}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            colorMode="dark"
            fitView
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={22} size={1.2} />
            <Controls position="bottom-left" />
            <MiniMap pannable zoomable className="!bg-background/80" />
          </ReactFlow>
        </div>

        {rightDrawer ? (
          <aside className="w-80 shrink-0 overflow-y-auto border-l bg-background">
            {rightDrawer}
          </aside>
        ) : selected && selectedSpec ? (
          <aside className="w-72 shrink-0 overflow-y-auto border-l bg-background p-4">
            <div className="mb-5 flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-muted text-muted-foreground">
                <NodeIcon spec={selectedSpec} />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Configuration
                </p>
                <p className="text-sm font-semibold">
                  {selected.data.displayLabel ?? selectedSpec.label}
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {selectedSpec.fields
                .filter((field) => (
                  !field.visibleWhen
                  || selected.data.config[field.visibleWhen.key]
                    === field.visibleWhen.equals
                ))
                .filter((field) => !field.advanced)
                .map(renderFieldBlock)}
              {extraPanel}
              {selectedSpec.fields.some((field) => field.advanced) && (
                <details className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Advanced configuration
                  </summary>
                  <div className="mt-3 space-y-4">
                    {selectedSpec.fields
                      .filter((field) => field.advanced && (
                        !field.visibleWhen
                        || selected.data.config[field.visibleWhen.key] === field.visibleWhen.equals
                      ))
                      .map(renderFieldBlock)}
                  </div>
                </details>
              )}
              {selectedSpec.fields.length === 0 && !extraPanel && (
                <div className="text-xs text-muted-foreground">
                  Nothing to configure.
                </div>
              )}
            </div>
            {selected.data.runtime?.outputPreview && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Last output
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-snug text-muted-foreground">
                  {selected.data.runtime.outputPreview}
                </pre>
              </div>
            )}
            {canEdit && (
              <Button
                onClick={() => setRemoveOpen(true)}
                className="mt-5 w-full"
                variant="outline"
              >
                <Trash2 className="h-4 w-4" />
                Remove node
              </Button>
            )}
          </aside>
        ) : null}
      </div>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove node?</DialogTitle>
            <DialogDescription>
              The node and every connection attached to it will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              Keep node
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedId) onRemoveNode(selectedId);
                setRemoveOpen(false);
              }}
            >
              Remove node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
