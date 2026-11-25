//! `cargo run --release -p octlook-ocr --example ocr -- <models dir> <image>`
use std::{path::Path, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let [_, models, image] = args.as_slice() else { return Err("usage: ocr <models dir> <image>".into()) };
    let t = Instant::now();
    let mut engine = octlook_ocr::Engine::load(Path::new(models))?;
    println!("load {:?}", t.elapsed());
    let img = image::open(image)?.into_rgba8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    for _ in 0..2 {
        let t = Instant::now();
        let lines = engine.recognize(octlook_ocr::Image::new(img.as_raw(), w, h)?)?;
        println!("recognize {:?}, {} lines", t.elapsed(), lines.len());
    }
    println!("{}", engine.text(octlook_ocr::Image::new(img.as_raw(), w, h)?)?);
    Ok(())
}
