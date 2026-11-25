use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Decode(#[from] octlook_core::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("移至回收站失败：{0}")]
    Trash(#[from] trash::Error),
    #[error("后台任务异常：{0}")]
    Task(String),
}

/// Errors cross the IPC boundary as plain, user-presentable strings.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
