//! Thumbnail probe for development.
//!
//! * Shell mode asks Windows for the thumbnail exactly as Explorer does
//!   (handler lookup, isolated surrogate, thumbnail cache): it shows which
//!   handler wins and fails when none produces a thumbnail.
//! * `--direct <dll>` loads the handler DLL in-process and drives its COM
//!   object, bypassing registration — for formats another handler owns.
//!
//! `cargo run -p octlook-shell --example probe -- <file> <out.png> [size] [--direct <dll>]`

use std::{ffi::c_void, time::Instant};

use windows::{
    core::{s, Interface, Result, GUID, HRESULT, HSTRING},
    Win32::{
        Foundation::{E_FAIL, SIZE},
        Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
            DIB_RGB_COLORS, HBITMAP,
        },
        System::{
            Com::{CoInitializeEx, IClassFactory, COINIT_APARTMENTTHREADED, STGM_READ},
            LibraryLoader::{GetProcAddress, LoadLibraryW},
        },
        UI::Shell::{
            IShellItemImageFactory, IThumbnailProvider, PropertiesSystem::IInitializeWithStream,
            SHCreateItemFromParsingName, SHCreateStreamOnFileEx, SIIGBF_THUMBNAILONLY, WTS_ALPHATYPE,
        },
    },
};

type GetClassObject = unsafe extern "system" fn(*const GUID, *const GUID, *mut *mut c_void) -> HRESULT;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [file, out, ..] = args.as_slice() else {
        eprintln!("usage: probe <file> <out.png> [size] [--direct <dll>]");
        std::process::exit(2);
    };
    let size: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(256);
    let direct = args.iter().position(|a| a == "--direct").and_then(|i| args.get(i + 1));

    // SAFETY: plain Win32/COM calls on this thread; pixel buffers are sized
    // from the bitmap's own dimensions.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let started = Instant::now();
        let hbitmap = match direct {
            Some(dll) => direct_thumbnail(dll, file, size)?,
            None => {
                let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(file.as_str()), None)?;
                factory.GetImage(SIZE { cx: size as i32, cy: size as i32 }, SIIGBF_THUMBNAILONLY)?
            }
        };
        let elapsed = started.elapsed();
        let (w, h, px) = read_pixels(hbitmap);
        image::RgbaImage::from_raw(w, h, px).expect("sized buffer").save(out).expect("write PNG");
        println!("{w}x{h} in {elapsed:?} -> {out}");
    }
    Ok(())
}

unsafe fn direct_thumbnail(dll: &str, file: &str, size: u32) -> Result<HBITMAP> {
    let module = LoadLibraryW(&HSTRING::from(dll))?;
    let entry = GetProcAddress(module, s!("DllGetClassObject")).ok_or(E_FAIL)?;
    let get_class_object: GetClassObject = std::mem::transmute(entry);
    let mut factory: Option<IClassFactory> = None;
    get_class_object(&octlook_shell::CLSID, &IClassFactory::IID, &mut factory as *mut _ as *mut *mut c_void).ok()?;
    let provider: IThumbnailProvider = factory.ok_or(E_FAIL)?.CreateInstance(None)?;
    let stream = SHCreateStreamOnFileEx(&HSTRING::from(file), STGM_READ.0, 0, false, None)?;
    provider.cast::<IInitializeWithStream>()?.Initialize(&stream, STGM_READ.0)?;
    let (mut hbitmap, mut alpha) = (HBITMAP::default(), WTS_ALPHATYPE::default());
    provider.GetThumbnail(size, &mut hbitmap, &mut alpha)?;
    Ok(hbitmap)
}

/// Copies a DIB's pixels out as RGBA and frees it.
unsafe fn read_pixels(hbitmap: HBITMAP) -> (u32, u32, Vec<u8>) {
    let mut bm = BITMAP::default();
    GetObjectW(hbitmap.into(), size_of::<BITMAP>() as i32, Some((&mut bm as *mut BITMAP).cast()));
    let (w, h) = (bm.bmWidth, bm.bmHeight);
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let dc = GetDC(None);
    GetDIBits(dc, hbitmap, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
    ReleaseDC(None, dc);
    let _ = DeleteObject(hbitmap.into());
    px.chunks_exact_mut(4).for_each(|p| p.swap(0, 2));
    (w as u32, h as u32, px)
}
