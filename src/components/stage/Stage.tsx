import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";

import { useColorProbe } from "../../hooks/useColorProbe";
import { usePdfPage } from "../../hooks/usePdfPage";
import { useElementSize } from "../../hooks/useElementSize";
import type { SourceState } from "../../hooks/useSource";
import { useViewport, type StageContent } from "../../hooks/useViewport";
import { colorMatrix, isNeutral } from "../../lib/edits";
import { cssTransform, exifOrientation } from "../../lib/viewport";
import { useEditState } from "../../store/edit";
import { useLibrary } from "../../store/library";
import { useTextState } from "../../store/text";
import { useViewState } from "../../store/view";
import { AnnotateBar, AnnotationLayer } from "./annotate";
import { CropBar, CropOverlay } from "./crop";
import { BitmapLayer, ImageLayer, PdfLayer } from "./layers";
import { Loupe, SplitDivider, StageError } from "./overlays";
import styles from "./Stage.module.css";

/** Above this device-pixel magnification pixels are drawn as crisp squares. */
const PIXELATED_FROM = 3;
const ADJUST_FILTER = "octlook-adjust";

export function Stage({ source, loading, error }: SourceState) {
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const pageNumber = useViewState((s) => s.page);
  const backdrop = useViewState((s) => s.backdrop);
  const picker = useViewState((s) => s.picker);
  const resetView = useViewState((s) => s.resetView);
  const adjust = useEditState((s) => s.adjust);
  const crop = useEditState((s) => s.crop);
  const draft = useEditState((s) => s.draft);
  const comparing = useEditState((s) => s.comparing);
  const split = useEditState((s) => s.split);
  const tool = useEditState((s) => s.tool);

  const pdf = usePdfPage(source?.kind === "pdf" ? source.doc : null, pageNumber);
  /** The whole source content; the crop tool works on it. */
  const full = useMemo<StageContent | null>(() => {
    if (!source) return null;
    const size = source.kind === "pdf" ? pdf : source;
    return size && { x: 0, y: 0, width: size.width, height: size.height, orientation: exifOrientation(source.meta.orientation) };
  }, [source, pdf]);
  /** What is on stage: the applied crop, or everything while re-cropping. */
  const content = useMemo(() => (full && crop && !draft ? { ...full, ...crop } : full), [full, crop, draft]);

  useEffect(() => resetView(), [source, resetView]);
  // Edits and extracted text belong to a single image (or page); edits are kept for when it comes back.
  useEffect(() => {
    const { entries, index } = useLibrary.getState();
    useEditState.getState().open(`${entries[index]?.path}#${pageNumber}`);
    useTextState.getState().clear();
  }, [source, pageNumber]);

  const probe = useColorProbe(picker, stageRef, content);
  const { view, dragging, handlers } = useViewport(stageRef, size, content, picker ? probe.pick : undefined);

  const matrix = useMemo(() => (isNeutral(adjust) ? null : colorMatrix(adjust)), [adjust]);

  const layers = (() => {
    if (!source || !full || !content || error) return null;
    const box: CSSProperties = {
      width: content.width,
      height: content.height,
      transform: cssTransform(view, content.orientation),
      imageRendering: view.scale * devicePixelRatio >= PIXELATED_FROM ? "pixelated" : "auto",
      overflow: draft ? "visible" : "hidden", // crop handles overhang the box
    };
    const inner: CSSProperties = { position: "absolute", left: -content.x, top: -content.y, width: full.width, height: full.height };
    const layer = (primary: boolean) => {
      const props = { primary, style: primary && matrix && !comparing ? { ...inner, filter: `url(#${ADJUST_FILTER})` } : inner };
      switch (source.kind) {
        case "image":
          return <ImageLayer source={source} {...props} />;
        case "bitmap":
          return <BitmapLayer source={source} {...props} />;
        case "pdf":
          return pdf && <PdfLayer page={pdf.page} width={pdf.width} height={pdf.height} scale={view.scale} {...props} />;
      }
    };
    const splitting = split !== null && matrix !== null && !draft;
    return (
      <>
        <div className={styles.content} style={box}>
          {layer(true)}
          <AnnotationLayer content={full} style={inner} />
          {draft && <CropOverlay stageRef={stageRef} content={full} draft={draft} />}
        </div>
        {splitting && (
          <div className={styles.before} style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}>
            <div className={styles.content} style={box}>
              {layer(false)}
            </div>
          </div>
        )}
        {splitting && <SplitDivider at={split} />}
        {draft && <CropBar content={full} draft={draft} />}
        {tool && <AnnotateBar content={full} tool={tool} />}
      </>
    );
  })();

  const onPointerMove = (e: PointerEvent) => {
    handlers.onPointerMove(e);
    probe.onPointerMove(e);
  };

  return (
    <div
      ref={stageRef}
      className={`${styles.stage} ${styles[backdrop]}`}
      data-context-menu
      data-cursor={picker ? "pick" : dragging ? "grabbing" : content ? "grab" : undefined}
      {...handlers}
      onPointerMove={onPointerMove}
      onPointerLeave={probe.onPointerLeave}
    >
      {matrix && (
        <svg className={styles.defs} aria-hidden>
          <filter id={ADJUST_FILTER} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={matrix.join(" ")} />
          </filter>
        </svg>
      )}
      {layers}
      {loading && <div className={styles.progress} />}
      {error && <StageError message={error} />}
      {!error && source?.meta.source === "preview" && (
        <div className={styles.badge} data-tip="该格式无法完整渲染，显示的是设计软件保存时内嵌的预览图" data-tip-side="bottom">
          内嵌预览
        </div>
      )}
      {probe.probe && <Loupe probe={probe.probe} />}
    </div>
  );
}
