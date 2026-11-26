import type { SourceState } from "../../hooks/useSource";
import { isImage } from "../../lib/source";
import { Stage } from "../stage/Stage";
import { DocumentStage } from "./DocumentStage";

/** The editing stage for images, a read-only viewer for everything else. */
export function SourceStage(state: SourceState) {
  const { source } = state;
  return source && !isImage(source) ? <DocumentStage {...state} source={source} /> : <Stage {...state} source={isImage(source) ? source : null} />;
}
