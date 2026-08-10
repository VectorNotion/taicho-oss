'use client';

import {
  forwardRef, useEffect, useImperativeHandle, useRef,
} from 'react';
import {
  forceSimulation, forceManyBody, forceLink, forceCollide, forceX, forceY,
  type Simulation, type SimulationLinkDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import type { BrainGraph, BrainNode, BrainNodeType } from '../types';
import { TYPE_COLOR, TYPE_RING, nodeRadius } from '../palette';
import { PHYS, LOD, ANIM, LABEL } from '../physics/constants';

export type SimNode = BrainNode & {
  x: number; y: number; vx: number; vy: number;
  fx?: number | null; fy?: number | null; entered: number;
};
type SimLink = SimulationLinkDatum<SimNode> & { kind: string };

export type BrainCanvasHandle = {
  setGraph(g: BrainGraph): void;
  mergeGraph(g: BrainGraph, originId?: string): void;
  focus(id: string | null): void;
  flyTo(id: string): void;
  setLens(lens: 'everything' | 'content' | 'prospects' | 'recent'): void;
  setPulse(id: string | null): void;
};

const CONTENT_TYPES = new Set<BrainNodeType>(['project', 'capability', 'topic', 'idea', 'draft', 'research-item', 'source']);
const PROSPECT_TYPES = new Set<BrainNodeType>(['prospect', 'prospect-research', 'qualification', 'persona']);
const RECENT_MS = 7 * 24 * 3600 * 1000;

/** Per-type anchor seeds (fractions of viewport) for gentle clustering. */
const CLUSTER: Partial<Record<BrainNodeType, [number, number]>> = {
  project: [0.42, 0.5], capability: [0.35, 0.55], topic: [0.62, 0.38],
  idea: [0.74, 0.62], draft: [0.78, 0.68], 'research-item': [0.55, 0.25],
  source: [0.5, 0.2], prospect: [0.84, 0.3], 'prospect-research': [0.88, 0.24],
  qualification: [0.88, 0.36], persona: [0.9, 0.44],
};

export const BrainCanvas = forwardRef<BrainCanvasHandle, {
  onSelectNode: (node: BrainNode) => void;
  onClearFocus: () => void;
}>(function BrainCanvas({ onSelectNode, onClearFocus }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onSelectNode, onClearFocus });
  callbacks.current = { onSelectNode, onClearFocus };

  const state = useRef({
    nodes: [] as SimNode[],
    links: [] as SimLink[],
    byId: new Map<string, SimNode>(),
    nbr: new Map<string, Set<string>>(),
    sim: null as Simulation<SimNode, SimLink> | null,
    transform: zoomIdentity as ZoomTransform,
    focusId: null as string | null,
    pulseId: null as string | null,
    hoverId: null as string | null,
    lens: 'everything' as 'everything' | 'content' | 'prospects' | 'recent',
    dragging: null as SimNode | null,
    size: { w: 0, h: 0 },
    reduced: false,
  });

  const zoomBehavior = useRef(
    zoom<HTMLCanvasElement, unknown>().scaleExtent([LOD.zoomMin, LOD.zoomMax]),
  ).current;

  function rebuildNeighbors() {
    const s = state.current;
    s.nbr = new Map(s.nodes.map((n) => [n.id, new Set([n.id])]));
    for (const l of s.links) {
      const a = (l.source as SimNode).id;
      const b = (l.target as SimNode).id;
      s.nbr.get(a)?.add(b);
      s.nbr.get(b)?.add(a);
    }
  }

  function applyForces() {
    const s = state.current;
    if (!s.sim) return;
    s.sim.nodes(s.nodes);
    (s.sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>>).links(s.links);
    s.sim
      .force('x', forceX<SimNode>((d) => (CLUSTER[d.type]?.[0] ?? 0.5) * s.size.w).strength(PHYS.clusterStrength))
      .force('y', forceY<SimNode>((d) => (CLUSTER[d.type]?.[1] ?? 0.5) * s.size.h).strength(PHYS.clusterStrength));
    s.sim.alpha(PHYS.reheatAlpha).restart();
  }

  useImperativeHandle(ref, () => ({
    setGraph(g) {
      const s = state.current;
      s.nodes = g.nodes.map((n) => ({
        ...n,
        x: (CLUSTER[n.type]?.[0] ?? 0.5) * (s.size.w || 900) + (Math.random() - 0.5) * 120,
        y: (CLUSTER[n.type]?.[1] ?? 0.5) * (s.size.h || 600) + (Math.random() - 0.5) * 120,
        vx: 0, vy: 0, entered: performance.now(),
      }));
      s.byId = new Map(s.nodes.map((n) => [n.id, n]));
      s.links = g.links
        .filter((l) => s.byId.has(l.a) && s.byId.has(l.b))
        .map((l) => ({ source: s.byId.get(l.a)!, target: s.byId.get(l.b)!, kind: l.kind }));
      rebuildNeighbors();
      applyForces();
    },
    mergeGraph(g, originId) {
      const s = state.current;
      const origin = originId ? s.byId.get(originId) : undefined;
      const ox = origin?.x ?? s.size.w / 2, oy = origin?.y ?? s.size.h / 2;
      for (const n of g.nodes) {
        if (s.byId.has(n.id)) continue;
        const sn: SimNode = {
          ...n,
          x: ox + (Math.random() - 0.5) * 40, y: oy + (Math.random() - 0.5) * 40,
          vx: 0, vy: 0, entered: performance.now(),
        };
        s.nodes.push(sn); s.byId.set(n.id, sn);
      }
      const have = new Set(s.links.map((l) => `${(l.source as SimNode).id}|${(l.target as SimNode).id}`));
      for (const l of g.links) {
        if (!s.byId.has(l.a) || !s.byId.has(l.b)) continue;
        if (have.has(`${l.a}|${l.b}`) || have.has(`${l.b}|${l.a}`)) continue;
        s.links.push({ source: s.byId.get(l.a)!, target: s.byId.get(l.b)!, kind: l.kind });
      }
      rebuildNeighbors();
      applyForces();
    },
    focus(id) { state.current.focusId = id; },
    flyTo(id) {
      const s = state.current;
      const n = s.byId.get(id);
      const canvas = canvasRef.current;
      if (!n || !canvas) return;
      const k = Math.max(1, s.transform.k);
      const t = zoomIdentity.translate(s.size.w / 2 - n.x * k, s.size.h / 2 - n.y * k).scale(k);
      zoomBehavior.transform(select(canvas) as never, t);
      s.focusId = id;
      callbacks.current.onSelectNode(n);
    },
    setLens(lens) { state.current.lens = lens; },
    setPulse(id) { state.current.pulseId = id; },
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const s = state.current;
    s.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      s.size = { w: r.width, h: r.height };
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas); resize();

    s.sim = forceSimulation<SimNode>([])
      .force('charge', forceManyBody().strength(PHYS.charge))
      .force('link', forceLink<SimNode, SimLink>([]).distance(PHYS.linkDistance).strength(PHYS.linkStrength))
      .force('collide', forceCollide<SimNode>((d) => nodeRadius(d.degree) + PHYS.collidePad))
      .alphaDecay(PHYS.alphaDecay)
      .velocityDecay(PHYS.velocityDecay)
      .stop();

    const toWorld = (mx: number, my: number): [number, number] => [
      (mx - s.transform.x) / s.transform.k,
      (my - s.transform.y) / s.transform.k,
    ];
    const pick = (mx: number, my: number): SimNode | null => {
      const [wx, wy] = toWorld(mx, my);
      let best: SimNode | null = null; let bd = 18 / s.transform.k;
      for (const n of s.nodes) {
        const d = Math.hypot(n.x - wx, n.y - wy) - nodeRadius(n.degree);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };

    // A press on a node belongs to the node (drag/select); a press on empty
    // space belongs to the camera (pan). Without this filter d3-zoom starts
    // a pan from its own mouse listeners even when the pointer event was
    // consumed, so dragging a node panned the whole canvas with it.
    zoomBehavior.filter((ev: Event & { type: string; ctrlKey?: boolean; button?: number; touches?: TouchList; clientX?: number; clientY?: number }) => {
      if (ev.type === 'mousedown' || ev.type === 'pointerdown' || ev.type === 'touchstart') {
        const r = canvas.getBoundingClientRect();
        const t = (ev.touches?.[0] ?? ev) as { clientX: number; clientY: number };
        if (pick(t.clientX - r.left, t.clientY - r.top)) return false;
      }
      return (!ev.ctrlKey || ev.type === 'wheel') && !ev.button;
    });
    zoomBehavior.on('zoom', (ev) => { s.transform = ev.transform; });
    select(canvas).call(zoomBehavior as never).on('dblclick.zoom', null);

    let downNode: SimNode | null = null; let moved = false;
    let downX = 0; let downY = 0;
    const onDown = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      downNode = pick(ev.clientX - r.left, ev.clientY - r.top);
      moved = false;
      downX = ev.clientX; downY = ev.clientY;
      if (downNode) {
        s.dragging = downNode;
        downNode.fx = downNode.x; downNode.fy = downNode.y;
        s.sim?.alphaTarget(PHYS.dragAlphaTarget).restart();
        canvas.setPointerCapture(ev.pointerId);
        ev.stopImmediatePropagation();
      }
    };
    const onMove = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (s.dragging) {
        const [wx, wy] = toWorld(mx, my);
        s.dragging.fx = wx; s.dragging.fy = wy;
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 3) moved = true;
      } else {
        s.hoverId = pick(mx, my)?.id ?? null;
        canvas.style.cursor = s.hoverId ? 'pointer' : 'grab';
      }
    };
    const onUp = () => {
      if (s.dragging) {
        s.dragging.fx = null; s.dragging.fy = null; s.dragging = null;
        s.sim?.alphaTarget(0);
      }
      if (downNode && !moved) {
        s.focusId = downNode.id;
        callbacks.current.onSelectNode(downNode);
      } else if (!downNode && !moved) {
        s.focusId = null;
        callbacks.current.onClearFocus();
      }
      downNode = null;
    };
    canvas.addEventListener('pointerdown', onDown, { capture: true });
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);

    const now = () => performance.now();
    let raf = 0;
    const frame = () => {
      if (!s.reduced || s.dragging) s.sim?.tick();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s.size.w, s.size.h);
      ctx.save();
      ctx.translate(s.transform.x, s.transform.y);
      ctx.scale(s.transform.k, s.transform.k);
      const k = s.transform.k;
      const focusSet = s.focusId ? s.nbr.get(s.focusId) : null;
      const lensAlpha = (n: SimNode): number => {
        if (s.lens === 'content') return CONTENT_TYPES.has(n.type) ? 1 : 0.15;
        if (s.lens === 'prospects') return PROSPECT_TYPES.has(n.type) ? 1 : 0.15;
        if (s.lens === 'recent') {
          const recent = n.createdAt && now() - Date.parse(n.createdAt) < RECENT_MS;
          return recent ? 1 : 0.15;
        }
        return 1;
      };
      if (k >= LOD.farK) {
        for (const l of s.links) {
          const a = l.source as SimNode, b = l.target as SimNode;
          const lit = focusSet && (a.id === s.focusId || b.id === s.focusId);
          ctx.globalAlpha = focusSet
            ? (lit ? ANIM.focusEdgeAlpha : 0.05)
            : ANIM.edgeAlpha * Math.min(lensAlpha(a), lensAlpha(b));
          ctx.strokeStyle = lit ? '#b9aefc' : '#8a8aa3';
          ctx.lineWidth = (lit ? 1.4 : 1) / k;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      for (const n of s.nodes) {
        const r0 = nodeRadius(n.degree);
        if (k < LOD.farK && r0 < LOD.farNodeR) continue;
        const enter = Math.min(1, (now() - n.entered) / ANIM.entranceMs);
        const r = r0 * (0.3 + 0.7 * enter);
        const dimmed = focusSet && !focusSet.has(n.id);
        ctx.globalAlpha = (dimmed ? ANIM.dimAlpha : 1) * lensAlpha(n) * enter;
        const color = TYPE_COLOR[n.type];
        if (n.id === s.hoverId || n.id === s.focusId || n.id === s.pulseId) {
          const pulse = n.id === s.pulseId ? 1 + 0.25 * Math.sin(now() / 180) : 1;
          ctx.beginPath(); ctx.arc(n.x, n.y, (r + 7) * pulse, 0, 7);
          ctx.fillStyle = color + '30'; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7);
        if (TYPE_RING.has(n.type)) {
          ctx.strokeStyle = color; ctx.lineWidth = 2 / k;
          ctx.fillStyle = '#0c0c15'; ctx.fill(); ctx.stroke();
        } else { ctx.fillStyle = color; ctx.fill(); }
        if (s.lens === 'recent' && n.createdAt && now() - Date.parse(n.createdAt) < RECENT_MS) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, 7);
          ctx.strokeStyle = color + '66'; ctx.lineWidth = 3 / k; ctx.stroke();
        }
        const labeled = k > LOD.detailK
          || (k >= LOD.farK && r0 >= LOD.majorLabelR)
          || n.id === s.hoverId || n.id === s.focusId
          || (focusSet?.has(n.id) ?? false);
        if (labeled && !dimmed) {
          // Full text only for the clicked or hovered node; everyone else
          // stays a stub — the neighborhood lights up, it doesn't shout.
          const full = n.id === s.focusId || n.id === s.hoverId;
          const text = full || n.label.length <= LABEL.stub + 1
            ? n.label
            : n.label.slice(0, LABEL.stub) + '\u2026';
          ctx.fillStyle = '#e9e9f4';
          ctx.font = `${n.id === s.focusId ? '600 ' : ''}${11 / k}px -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(text, n.x, n.y - r - 7 / k);
        }
      }
      if (k < LOD.farK) {
        const groups = new Map<string, { x: number; y: number; c: number; color: string; word: string }>();
        for (const n of s.nodes) {
          const key = PROSPECT_TYPES.has(n.type) ? 'Pipeline' : n.type === 'topic' ? 'Topics' : 'Product';
          const g = groups.get(key) ?? { x: 0, y: 0, c: 0, color: TYPE_COLOR[n.type], word: key };
          g.x += n.x; g.y += n.y; g.c += 1;
          groups.set(key, g);
        }
        for (const g of groups.values()) {
          if (g.c < 2) continue;
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = g.color;
          ctx.font = `${13 / k}px -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(g.word, g.x / g.c, g.y / g.c);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); s.sim?.stop();
      canvas.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time canvas setup
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full touch-none" style={{ background: '#0c0c15' }} />;
});
