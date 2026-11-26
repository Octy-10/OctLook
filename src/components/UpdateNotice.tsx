import { useUpdate } from "../store/update";
import styles from "./UpdateNotice.module.css";

export function UpdateNotice() {
  const state = useUpdate((s) => s.state);
  const { install, dismiss } = useUpdate.getState();
  if (state.phase === "idle" || state.phase === "checking") return null;

  return (
    <aside className={styles.card} role="status">
      {state.phase === "available" && (
        <>
          <p className={styles.title}>新版本 {state.version} 可用</p>
          {state.changes.length > 0 && (
            <ul className={styles.changes}>
              {state.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
          <p className={styles.hint}>安装时需要管理员确认，完成后自动重启</p>
          <div className={styles.actions}>
            <button className={styles.ghost} onClick={dismiss}>
              稍后
            </button>
            <button className={styles.primary} onClick={() => void install()}>
              更新并重启
            </button>
          </div>
        </>
      )}
      {state.phase === "installing" && (
        <>
          <p className={styles.title}>
            正在下载更新{state.progress === null ? "…" : ` ${Math.round(state.progress * 100)}%`}
          </p>
          <div className={styles.track}>
            <div
              className={styles.bar}
              data-indeterminate={state.progress === null || undefined}
              style={{ width: state.progress === null ? undefined : `${state.progress * 100}%` }}
            />
          </div>
        </>
      )}
      {state.phase === "failed" && (
        <>
          <p className={styles.title}>更新失败</p>
          <p className={styles.hint}>{state.message}</p>
          <div className={styles.actions}>
            <button className={styles.ghost} onClick={dismiss}>
              关闭
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
