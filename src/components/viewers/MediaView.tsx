import { useRef, useState, type FocusEvent } from "react";
import { Music, Play } from "lucide-react";

import type { DocumentSource } from "../../lib/source";
import { useCurrentEntry } from "../../store/library";
import { StageError } from "../stage/overlays";
import styles from "./viewers.module.css";

type Media = Extract<DocumentSource, { kind: "video" | "audio" }>;

/** Plays what the WebView can decode; other codecs arrive with the FFmpeg pipeline. */
export function MediaView({ source }: { source: Media }) {
  const entry = useCurrentEntry();
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // Videos autoplay: hidden until the first pause, so it never flashes on open.
  const [paused, setPaused] = useState(false);
  const play = () => void video.current?.play();
  if (failed) return <StageError message={`暂不支持播放此${source.kind === "video" ? "视频" : "音频"}的编码（${source.meta.format}）`} />;

  const media = {
    src: source.url,
    controls: true,
    // No ⋮ menu (download, speed, remote playback): it could never stay open, as the player never keeps focus.
    controlsList: "nodownload noplaybackrate noremoteplayback",
    autoPlay: true,
    onError: () => setFailed(true),
    onPlay: () => setPaused(false),
    onPause: () => setPaused(true),
    // Keys belong to the viewer (Space = next file): the player never keeps focus.
    onFocus: (e: FocusEvent<HTMLMediaElement>) => e.currentTarget.blur(),
  };
  if (source.kind === "video") {
    return (
      <div className={styles.player}>
        <video key={source.url} ref={video} className={styles.video} playsInline disablePictureInPicture {...media} />
        {/* Only while paused; never takes focus, so Space keeps meaning "next file". */}
        {paused && (
          <button className={styles.play} aria-label="播放" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={play}>
            <Play size={26} fill="currentColor" strokeWidth={0} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={styles.audio}>
      <div className={styles.cover}>
        {source.cover ? <img src={source.cover} alt="" draggable={false} /> : <Music size={56} strokeWidth={1.25} />}
      </div>
      <h2>{entry?.name}</h2>
      <p>{source.meta.format}</p>
      <audio key={source.url} {...media} />
    </div>
  );
}
