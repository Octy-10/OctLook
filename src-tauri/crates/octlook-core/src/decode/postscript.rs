//! EPS and PostScript are programs, not pictures: Ghostscript runs them into a
//! PDF, which the viewer then draws as vectors like any other PDF. The app
//! points this module at its bundled Ghostscript at start-up; without one,
//! callers fall back to the preview the authoring app embedded.

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use image::RgbaImage;

use crate::{Error, Result};

static GHOSTSCRIPT: OnceLock<PathBuf> = OnceLock::new();
/// A file that runs longer than this is taken for a runaway program.
const TIMEOUT: Duration = Duration::from_secs(30);
/// Explorer waits on thumbnails: give up on them sooner.
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(10);

/// Uses the Ghostscript bundled at `bundled` when present, else one installed on the system.
pub fn init(bundled: &Path) {
    if let Some(exe) = Some(bundled.to_path_buf()).filter(|p| p.is_file()).or_else(installed) {
        let _ = GHOSTSCRIPT.set(exe);
    }
}

pub fn available() -> bool {
    GHOSTSCRIPT.get().is_some()
}

/// The newest `C:\Program Files\gs\gs*\bin\gswin64c.exe`.
#[cfg(windows)]
fn installed() -> Option<PathBuf> {
    let root = Path::new(&std::env::var_os("ProgramFiles")?).join("gs");
    let mut found: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(|entry| Some(entry.ok()?.path().join(r"bin\gswin64c.exe")))
        .filter(|exe| exe.is_file())
        .collect();
    found.sort(); // gs10.03.1 < gs10.08.0
    found.pop()
}

/// Homebrew's `gs`, on Apple silicon or Intel.
#[cfg(not(windows))]
fn installed() -> Option<PathBuf> {
    ["/opt/homebrew/bin/gs", "/usr/local/bin/gs"].into_iter().map(PathBuf::from).find(|p| p.is_file())
}

/// Runs `path` through Ghostscript into a PDF cropped to its bounding box.
pub fn to_pdf(path: &Path) -> Result<Vec<u8>> {
    let pdf = run(&["-sDEVICE=pdfwrite"], path, TIMEOUT)?;
    pdf.starts_with(b"%PDF").then_some(pdf).ok_or(Error::Corrupt("Ghostscript 未生成内容"))
}

/// Draws the first page of `buf` (an EPS or PostScript file) with its longer
/// edge `size` px, transparent around the artwork: Explorer's thumbnail when
/// the file embeds no preview.
pub fn thumbnail(buf: &[u8], size: u32) -> Result<RgbaImage> {
    // Without a bounding box, a PostScript page is taken to be A4 (842 pt tall).
    let edge = bounding_box(buf).map_or(842.0, |(w, h)| w.max(h));
    let dpi = format!("-r{:.2}", f64::from(size) * 72.0 / edge);
    let input = temp_path("ps");
    std::fs::write(&input, buf)?;
    let png = run(&["-sDEVICE=pngalpha", "-dTextAlphaBits=4", "-dGraphicsAlphaBits=4", "-dFirstPage=1", "-dLastPage=1", &dpi], &input, THUMBNAIL_TIMEOUT);
    let _ = std::fs::remove_file(&input);
    Ok(image::load_from_memory_with_format(&png?, image::ImageFormat::Png)?.into_rgba8())
}

/// Width and height in points from the `%%BoundingBox` DSC comment.
fn bounding_box(buf: &[u8]) -> Option<(f64, f64)> {
    let head = String::from_utf8_lossy(&buf[..buf.len().min(64 << 10)]);
    let numbers: Vec<f64> = head
        .split(['\r', '\n']) // classic Mac files end lines with CR alone
        .find_map(|line| line.strip_prefix("%%BoundingBox:"))?
        .split_whitespace()
        .map(str::parse)
        .collect::<std::result::Result<_, _>>()
        .ok()?;
    let [llx, lly, urx, ury] = numbers[..] else { return None };
    Some((urx - llx, ury - lly)).filter(|&(w, h)| w > 0.0 && h > 0.0)
}

fn temp_path(ext: &str) -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    std::env::temp_dir().join(format!("octlook-{}-{}.{ext}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)))
}

/// Runs `input` through Ghostscript on `device` arguments, cropped to its
/// bounding box, and returns what it wrote.
fn run(device: &[&str], input: &Path, timeout: Duration) -> Result<Vec<u8>> {
    let gs = GHOSTSCRIPT.get().ok_or_else(|| Error::Unsupported("PostScript（未找到 Ghostscript）".into()))?;
    let out = temp_path("out");
    let mut command = Command::new(gs);
    command
        // -dSAFER: the file may read no other file and write none but the output.
        .args(["-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dEPSCrop"])
        .args(device)
        .arg(format!("-sOutputFile={}", out.display()))
        .arg("--")
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn()?;
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(15));
    };
    let written = std::fs::read(&out);
    let _ = std::fs::remove_file(&out);
    match status {
        Some(status) if status.success() => written.ok().filter(|w| !w.is_empty()).ok_or(Error::Corrupt("Ghostscript 未生成内容")),
        Some(_) => Err(Error::Corrupt("PostScript 程序运行出错")),
        None => Err(Error::Corrupt("PostScript 程序运行超时")),
    }
}

#[cfg(test)]
mod tests {
    use super::bounding_box;

    #[test]
    fn reads_the_bounding_box() {
        assert_eq!(bounding_box(b"%!PS-Adobe-3.0 EPSF-3.0\r%%BoundingBox: 10 20 110 70\r"), Some((100.0, 50.0)));
        assert_eq!(bounding_box(b"%!PS\n%%BoundingBox: (atend)\n"), None);
        assert_eq!(bounding_box(b"%!PS\nshowpage\n"), None);
    }
}
