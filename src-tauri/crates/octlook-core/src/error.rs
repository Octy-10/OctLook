#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("图像解码失败：{0}")]
    Image(#[from] image::ImageError),
    #[error("压缩包读取失败：{0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("文件已损坏或结构异常：{0}")]
    Corrupt(&'static str),
    #[error("不支持：{0}")]
    Unsupported(String),
    #[error("未找到可用的预览图（{0}）")]
    NoPreview(&'static str),
    #[cfg(windows)]
    #[error("系统解码器（WIC）失败：{0}")]
    Wic(#[from] windows::core::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
