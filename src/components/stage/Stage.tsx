import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";

import { useColorProbe } from "../../hooks/useColorProbe";
import { usePdfPage } from "../../hooks/usePdfPage";
import { useElementSize } from "../../hooks/useElementSize";
import type { SourceState } from "../../hooks/useSource";
import { useViewport, type StageContent } from "../../hooks/useViewport";
import { cssTransform, exifOrientation } from "../../lib/viewport";
import { useViewState } from "../../store/view";
import { BitmapLayer, ImageLayer, PdfLayer } from "./layers";
import { Loupe, StageError } from "./overlays";
import styles from "./Stage.module.css";

/** Above this device-pixel magnification pixels are drawn as crisp squares. */
const PIXELATED_FROM = 3;

export function Stage({ source, loading, error }: SourceState) {
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(stageRef);
  const pageNumber = useViewState((s) => s.page);
  const backdrop = useViewState((s) => s.backdrop);
  const picker = useViewState((s) => s.picker);
  const resetView = useViewState((s) => s.resetView);

  const pdf = usePdfPage(source?.kind === "pdf" ? source.doc : null, pageNumber);
  const content = useMemo<StageContent | null>(() => {
    if (!source) return null;
    const orientation = exifOrientation(source.meta.orientation);
    if (source.kind === "pdf") return pdf && { width: pdf.width, height: pdf.height, orientation };
    return { width: source.width, height: source.height, orientation };
  }, [source, pdf]);

  useEffect(() => resetView(), [source, resetView]);

  const probe = useColorProbe(picker, stageRef, content);
  const { view, dragging, handlers } = useViewport(stageRef, size, content, picker ? probe.pick : undefined);

  const layerStyle: CSSProperties | null = content && {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: content.width,
    height: content.height,
    transform: cssTransform(view, content.orientation),
    imageRendering: view.scale * devicePixelRatio >= PIXELATED_FROM ? "pixelated" : "auto",
  };

  const layer = (() => {
    if (!source || !layerStyle) return null;
    const common = { style: layerStyle, registerSampler: probe.registerSampler };
    switch (source.kind) {
      case "image":
        return <ImageLayer source={source} {...common} />;
      case "bitmap":
        return <BitmapLayer source={source} {...common} />;
      case "pdf":
        return pdf && <PdfLayer page={pdf.page} width={pdf.width} height={pdf.height} scale={view.scale} {...common} />;
    }
  })();

  const onPointerMove = (e: PointerEvent) => {
    handlers.onPointerMove(e);
    probe.onPointerMove(e);
  };

  return (
    <div
      ref={stageRef}
      className={`${styles.stage} ${styles[backdrop]}`}
      data-cursor={picker ? "pick" : dragging ? "grabbing" : content ? "grab" : undefined}
      {...handlers}
      onPointerMove={onPointerMove}
      onPointerLeave={probe.onPointerLeave}
    >
      {!error && layer}
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
