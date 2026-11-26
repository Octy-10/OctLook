import type { DocumentSource } from "../../lib/source";
import { StageError } from "../stage/overlays";
import stage from "../stage/Stage.module.css";
import { FontView } from "./FontView";
import { MediaView } from "./MediaView";
import { TextView } from "./TextView";
import styles from "./viewers.module.css";

interface Props {
  source: DocumentSource;
  loading: boolean;
  error: string | null;
}

/** Stage for everything that is not an image: read-only, no zoom or editing tools. */
export function DocumentStage({ source, loading, error }: Props) {
  const view = (() => {
    switch (source.kind) {
      case "video":
      case "audio":
        return <MediaView source={source} />;
      case "text":
        return <TextView source={source} />;
      case "font":
        return <FontView source={source} />;
    }
  })();
  return (
    <div className={styles.stage} data-kind={source.kind} data-context-menu>
      {!error && view}
      {loading && <div className={stage.progress} />}
      {error && <StageError message={error} />}
    </div>
  );
}
