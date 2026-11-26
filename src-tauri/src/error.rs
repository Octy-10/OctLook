use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Decode(#[from] octlook_core::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Ocr(#[from] octlook_ocr::Error),
    #[error("移至回收站失败：{0}")]
    Trash(#[from] trash::Error),
    #[error("无法用关联程序打开：{0}")]
    Launch(String),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("后台任务异常：{0}")]
    Task(String),
    #[error("请求格式无效")]
    BadRequest,
}

/// Errors cross the IPC boundary as plain, user-presentable strings.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
