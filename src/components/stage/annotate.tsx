import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { Check, MoveUpRight, PenLine, Redo2, Square, Trash2, Type, Undo2 } from "lucide-react";

import type { StageContent } from "../../hooks/useViewport";
import { editActions } from "../../lib/actions";
import {
  arrowShape,
  dragHandle,
  fontOf,
  handlesOf,
  INK_COLORS,
  measureText,
  moveAnnotation,
  penCorners,
  penPath,
  restyle,
  sizeAt,
  sizeOf,
  sizing,
  textCorners,
  uprightFor,
  uprightTransform,
  type Annotation,
  type Handle,
  type Ink,
  type Point,
  type TextAnnotation,
  type Tool,
} from "../../lib/annotate";
import { isMac, keys } from "../../lib/platform";
import { useEditState } from "../../store/edit";
import { useViewState } from "../../store/view";
import bar from "./toolbar.module.css";
import styles from "./annotate.module.css";

/** Shapes dragged out smaller than this many screen px are treated as a slip. */
const MIN_DRAG = 4;
/** Handle half-size, corner hit radius and edge hit half-width in screen px. */
const HANDLE = 4;
const HANDLE_HIT = 11;
const EDGE_HIT = 6;
/** A freehand stroke takes a new point once the pointer moved this many screen px. */
const PEN_STEP = 2;

const edit = () => useEditState.getState();
const patch = (id: string, update: (a: Annotation) => Annotation) =>
  edit().set({ annotations: edit().annotations.map((a) => (a.id === id ? update(a) : a)) });
const remove = (id: string) => edit().set({ annotations: edit().annotations.filter((a) => a.id !== id), selected: null, editing: null });

function Shape({ a }: { a: Annotation }) {
  if (a.kind === "rect") {
    return <rect data-id={a.id} x={a.x} y={a.y} width={a.width} height={a.height} fill="none" stroke={a.color} strokeWidth={a.stroke} strokeLinejoin="round" />;
  }
  if (a.kind === "pen") {
    return <path data-id={a.id} d={penPath(a.points)} fill="none" stroke={a.color} strokeWidth={a.stroke} strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (a.kind === "arrow") {
    const { shaftEnd, head } = arrowShape(a);
    return (
      <g data-id={a.id} stroke={a.color} fill={a.color}>
        <line x1={a.x1} y1={a.y1} x2={shaftEnd[0]} y2={shaftEnd[1]} strokeWidth={a.stroke} />
        <polygon points={head.join(" ")} stroke="none" />
      </g>
    );
  }
  return (
    <text data-id={a.id} transform={`translate(${a.x} ${a.y}) ${uprightTransform(a.upright, "")}`} style={{ font: fontOf(a.size) }} fill={a.color}>
      {a.text}
    </text>
  );
}

const outlineOf = (a: Annotation): Point[] | null =>
  a.kind === "text"
    ? textCorners(a)
    : a.kind === "pen"
      ? penCorners(a.points)
      : a.kind === "rect"
        ? [[a.x, a.y], [a.x + a.width, a.y], [a.x + a.width, a.y + a.height], [a.x, a.y + a.height]]
        : null;

const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/** Resize cursor matching the on-screen direction `handle` moves in, whatever the rotation or flips. */
function resizeCursor(handle: Handle, svg: SVGSVGElement) {
  if (handle.key === "start" || handle.key === "end") return "grab";
  const [dx, dy] = handle.axis === "x" ? [1, 0] : handle.axis === "y" ? [0, 1] : [handle.x - handle.anchor[0], handle.y - handle.anchor[1]];
  const m = svg.getScreenCTM()!;
  const degrees = (Math.atan2(m.b * dx + m.d * dy, m.a * dx + m.c * dy) * 180) / Math.PI;
  return RESIZE_CURSORS[Math.round((((degrees % 180) + 180) % 180) / 45) % 4];
}

/**
 * Bounds, move area and drag handles of the selected annotation; `px` is one
 * screen pixel in content space. Inside the bounds drags move it, edges and
 * corners resize it.
 */
function Selection({ a, px, handles }: { a: Annotation; px: number; handles: boolean }) {
  const outline = outlineOf(a)?.join(" ");
  return (
    <g className={styles.selection}>
      {outline && (
        <>
          <polygon className={styles.body} data-id={a.id} points={outline} />
          <polygon className={styles.outline} points={outline} strokeWidth={px} strokeDasharray={a.kind === "rect" ? undefined : `${4 * px} ${3 * px}`} />
        </>
      )}
      {handles &&
        handlesOf(a).map((h) =>
          h.span ? (
            <line key={h.key} data-handle={h.key} x1={h.span[0][0]} y1={h.span[0][1]} x2={h.span[1][0]} y2={h.span[1][1]} stroke="transparent" strokeWidth={2 * EDGE_HIT * px} />
          ) : (
            <g key={h.key} data-handle={h.key}>
              <circle cx={h.x} cy={h.y} r={HANDLE_HIT * px} fill="transparent" stroke="none" />
              <rect x={h.x - HANDLE * px} y={h.y - HANDLE * px} width={2 * HANDLE * px} height={2 * HANDLE * px} rx={1.5 * px} strokeWidth={1.5 * px} />
            </g>
          ),
        )}
    </g>
  );
}

/**
 * Caret and keyboard input for the text being edited. Its own glyphs are
 * transparent: the SVG text underneath stays the single, exact rendering.
 */
function TextEditor({ a }: { a: TextAnnotation }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.textContent = a.text;
    el.focus();
    getSelection()?.selectAllChildren(el);
  }, [a.id]); // uncontrolled afterwards, so the caret and IME composition are never disturbed

  const { ascent, descent } = measureText("", a.size);
  return (
    <div
      ref={ref}
      className={styles.editor}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      style={{
        left: a.x,
        top: a.y,
        transform: `${uprightTransform(a.upright, "deg")} translateY(${-ascent}px)`,
        font: fontOf(a.size),
        lineHeight: `${ascent + descent}px`,
        caretColor: a.color,
      }}
      onInput={(e) => {
        const text = e.currentTarget.textContent ?? "";
        patch(a.id, (t) => ({ ...t, text }));
      }}
      onBlur={() => (edit().annotations.some((t) => t.id === a.id && t.kind === "text" && t.text.trim()) ? edit().set({ editing: null }) : remove(a.id))}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === "Escape") && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

type Gesture = { id: string; from: Point; travelled: number; created: boolean } & (
  | { mode: "move"; last: Point }
  | { mode: "resize"; origin: Annotation; handle: Handle }
  | { mode: "draw"; last: Point }
);

interface LayerProps {
  /** The uncropped content the annotations are anchored to. */
  content: StageContent;
  style: CSSProperties;
}

/** Annotations in content space; while a tool is active they are created, moved, resized and typed into in place. */
export function AnnotationLayer({ content, style }: LayerProps) {
  const annotations = useEditState((s) => s.annotations);
  const tool = useEditState((s) => s.tool);
  const selected = useEditState((s) => s.selected);
  const editing = useEditState((s) => s.editing);
  const scale = useViewState((s) => s.view.scale);
  const ref = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const current = tool ? annotations.find((a) => a.id === selected) : undefined;

  /** Client point → content px; the SVG's own matrix already includes every stage transform. */
  const toContent = (e: PointerEvent): Point => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ref.current!.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!tool || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const from = toContent(e);
    // Focus is managed here (see onMouseDown): a press outside the text being typed commits it.
    const committing = edit().editing !== null;
    if (committing && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    edit().checkpoint();
    const svg = e.currentTarget;
    /** The cursor of the gesture holds for its whole drag, wherever the pointer strays. */
    const begin = (g: Gesture, cursor: string) => {
      gesture.current = g;
      svg.style.cursor = cursor;
    };

    const handle = handleAt(target);
    if (current && handle) return begin({ id: current.id, from, travelled: 0, created: false, mode: "resize", origin: current, handle }, resizeCursor(handle, svg));

    const hit = target.closest("[data-id]")?.getAttribute("data-id");
    if (hit) {
      edit().set({ selected: hit });
      return begin({ id: hit, from, travelled: 0, created: false, mode: "move", last: from }, "move");
    }
    if (committing) return; // that press only ended the typing

    const { ink } = edit();
    const [x, y] = from;
    const id = crypto.randomUUID();
    const size = sizeAt(tool, Math.max(content.width, content.height), ink[sizing(tool).key]);
    if (tool === "text") {
      const upright = uprightFor(useViewState.getState().view, content.orientation);
      const text: Annotation = { id, kind: "text", color: ink.color, x, y, text: "", size, upright };
      return edit().set({ annotations: [...edit().annotations, text], selected: id, editing: id });
    }
    if (tool === "pen") {
      edit().set({ annotations: [...edit().annotations, { id, kind: "pen", color: ink.color, points: [from], stroke: size }], selected: id });
      return begin({ id, from, travelled: 0, created: true, mode: "draw", last: from }, "crosshair");
    }
    const shape: Annotation =
      tool === "rect"
        ? { id, kind: "rect", color: ink.color, x, y, width: 0, height: 0, stroke: size }
        : { id, kind: "arrow", color: ink.color, x1: x, y1: y, x2: x, y2: y, stroke: size };
    edit().set({ annotations: [...edit().annotations, shape], selected: id });
    // Drawing a shape is dragging its far handle away from the press point.
    begin({ id, from, travelled: 0, created: true, mode: "resize", origin: shape, handle: handlesOf(shape).at(-1)! }, "crosshair");
  };

  /** The handle of the selection under `target`, if any. */
  const handleAt = (target: Element) => {
    const key = target.closest("[data-handle]")?.getAttribute("data-handle");
    return key ? current && handlesOf(current).find((h) => h.key === key) : undefined;
  };

  /** Handles show the resize cursor for the direction they move in on screen. */
  const onPointerOver = (e: PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const handle = handleAt(target);
    if (handle) (target.closest("[data-handle]") as SVGElement).style.cursor = resizeCursor(handle, e.currentTarget);
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const point = toContent(e);
    const [x, y] = point;
    g.travelled = Math.max(g.travelled, Math.hypot(x - g.from[0], y - g.from[1]) * scale);
    if (g.mode === "resize") return patch(g.id, () => dragHandle(g.origin, g.handle, x, y));
    const [dx, dy] = [x - g.last[0], y - g.last[1]];
    if (g.mode === "draw") {
      if (Math.hypot(dx, dy) * scale < PEN_STEP) return;
      g.last = point;
      return patch(g.id, (a) => (a.kind === "pen" ? { ...a, points: [...a.points, point] } : a));
    }
    g.last = point;
    patch(g.id, (a) => moveAnnotation(a, dx, dy));
  };

  const onRelease = () => {
    const g = gesture.current;
    gesture.current = null;
    ref.current!.style.cursor = "";
    if (g?.created && g.travelled < MIN_DRAG) remove(g.id);
  };

  const onDoubleClick = (e: MouseEvent) => {
    if (!tool) return;
    e.stopPropagation();
    // The press captured the pointer, so the event targets the SVG itself: hit-test the point instead.
    const id = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-id]")?.getAttribute("data-id");
    if (edit().annotations.some((a) => a.id === id && a.kind === "text")) {
      edit().checkpoint();
      edit().set({ selected: id, editing: id });
    }
  };

  const typed = annotations.find((a): a is TextAnnotation => a.id === editing && a.kind === "text");
  return (
    <div className={styles.layer} style={style}>
      <svg
        ref={ref}
        viewBox={`0 0 ${content.width} ${content.height}`}
        data-tool={tool ?? undefined}
        onPointerDown={onPointerDown}
        onPointerOver={onPointerOver}
        // Without this the browser moves focus to the page on press, blurring a just-opened text editor.
        onMouseDown={(e) => tool && e.preventDefault()}
        onPointerMove={onPointerMove}
        onLostPointerCapture={onRelease}
        onDoubleClick={onDoubleClick}
      >
        {annotations.map((a) => (
          <Shape key={a.id} a={a} />
        ))}
        {current && <Selection a={current} px={1 / scale} handles={!typed} />}
      </svg>
      {typed && <TextEditor a={typed} />}
    </div>
  );
}

const TOOLS: [tool: Tool, label: string, sizeLabel: string, icon: typeof Type][] = [
  ["text", "文字", "字号", Type],
  ["arrow", "箭头", "大小", MoveUpRight],
  ["rect", "矩形", "粗细", Square],
  ["pen", "画笔", "粗细", PenLine],
];

/** Annotation controls: tool, colour, one size slider that follows the tool or selection, delete / done. */
export function AnnotateBar({ content, tool }: { content: StageContent; tool: Tool }) {
  const ink = useEditState((s) => s.ink);
  const current = useEditState((s) => s.annotations.find((a) => a.id === s.selected));
  const canUndo = useEditState((s) => s.past.some((p) => p !== s.annotations));
  const canRedo = useEditState((s) => s.future.length > 0);
  const unit = Math.max(content.width, content.height);
  // The slider sizes the selection if there is one, otherwise what the tool will draw next.
  const kind = current?.kind ?? tool;
  const { key, range } = sizing(kind);
  const scale = current ? sizeOf(current) / sizeAt(kind, unit, 1) : ink[key];

  /** New ink becomes the default and restyles the selection. */
  const applyInk = (change: Partial<Ink>) => {
    const next = { ...edit().ink, ...change };
    edit().set({ ink: next });
    if (current) patch(current.id, (a) => restyle(a, next, unit));
  };

  return (
    <div className={bar.bar} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {TOOLS.map(([id, label, , Icon]) => (
        <button key={id} className={bar.chip} data-active={tool === id || undefined} onClick={() => edit().set({ tool: id, selected: null })}>
          <Icon size={14} /> {label}
        </button>
      ))}
      <span className={bar.divider} />
      {INK_COLORS.map((color) => (
        <button
          key={color}
          className={styles.swatch}
          style={{ background: color }}
          data-active={(current?.color ?? ink.color) === color || undefined}
          aria-label={`颜色 ${color}`}
          // Keeps focus (and the caret) in a text being typed.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            if (current) edit().checkpoint();
            applyInk({ color });
          }}
        />
      ))}
      <span className={bar.divider} />
      <label className={styles.size}>
        <span>{TOOLS.find(([id]) => id === kind)![2]}</span>
        <input
          type="range"
          min={range[0]}
          max={range[1]}
          step={0.05}
          value={Math.min(range[1], Math.max(range[0], scale))}
          onPointerDown={() => current && edit().checkpoint()}
          onKeyDown={() => current && edit().checkpoint()}
          onChange={(e) => applyInk({ [key]: e.target.valueAsNumber })}
          onPointerUp={(e) => e.currentTarget.blur()} // hand the arrow keys back to navigation
        />
        <output>{Math.round(sizeAt(kind, unit, scale))}</output>
      </label>
      <span className={bar.divider} />
      <button className={bar.action} data-tip={keys("撤销  Ctrl Z")} data-tip-side="bottom" disabled={!canUndo} onClick={() => edit().undo()}>
        <Undo2 size={15} />
      </button>
      <button className={bar.action} data-tip={keys(isMac ? "重做  Ctrl Shift Z" : "重做  Ctrl Y")} data-tip-side="bottom" disabled={!canRedo} onClick={() => edit().redo()}>
        <Redo2 size={15} />
      </button>
      <button className={bar.action} data-tip={keys("删除选中  Del")} data-tip-side="bottom" disabled={!current} onClick={editActions.removeSelected}>
        <Trash2 size={15} />
      </button>
      <button className={bar.action} data-primary data-tip="完成  Esc" data-tip-side="bottom" onClick={editActions.toggleAnnotate}>
        <Check size={15} />
      </button>
    </div>
  );
}
