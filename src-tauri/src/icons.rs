use std::ffi::c_void;
use std::path::Path;

use base64::Engine;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS,
};
use windows::Win32::UI::Shell::SHDefExtractIconW;
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

use crate::util::wide;

const ICON_SIZE: u32 = 48;

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// Split a DisplayIcon value such as `"C:\app\app.exe",0` into path and index.
fn parse_icon_spec(spec: &str) -> (String, i32) {
    let s = spec.trim();
    if let Some((left, right)) = s.rsplit_once(',') {
        if let Ok(index) = right.trim().parse::<i32>() {
            return (left.trim().trim_matches('"').to_string(), index);
        }
    }
    (s.trim_matches('"').to_string(), 0)
}

/// Extract an icon from an exe/dll/ico and return it as RGBA pixels.
unsafe fn extract_rgba(path: &str, index: i32) -> Option<(u32, u32, Vec<u8>)> {
    let file = wide(path);
    let mut hicon = HICON::default();
    let _ = SHDefExtractIconW(
        PCWSTR(file.as_ptr()),
        index,
        0,
        Some(&mut hicon),
        None,
        ICON_SIZE,
    );
    if hicon.is_invalid() {
        return None;
    }

    let mut info = ICONINFO::default();
    if GetIconInfo(hicon, &mut info).is_err() {
        let _ = DestroyIcon(hicon);
        return None;
    }

    let mut result = None;
    if !info.hbmColor.is_invalid() {
        let mut bmp = BITMAP::default();
        GetObjectW(
            info.hbmColor.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut c_void),
        );
        let (w, h) = (bmp.bmWidth, bmp.bmHeight);
        if w > 0 && h > 0 && w <= 512 && h <= 512 {
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: 0, // BI_RGB
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; (w * h * 4) as usize];
            let hdc = GetDC(None);
            let lines = GetDIBits(
                hdc,
                info.hbmColor,
                0,
                h as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, hdc);
            if lines > 0 {
                // BGRA -> RGBA; icons without an alpha channel become opaque.
                let has_alpha = pixels.chunks_exact(4).any(|p| p[3] != 0);
                for p in pixels.chunks_exact_mut(4) {
                    p.swap(0, 2);
                    if !has_alpha {
                        p[3] = 255;
                    }
                }
                result = Some((w as u32, h as u32, pixels));
            }
        }
    }

    if !info.hbmColor.is_invalid() {
        let _ = DeleteObject(info.hbmColor.into());
    }
    if !info.hbmMask.is_invalid() {
        let _ = DeleteObject(info.hbmMask.into());
    }
    let _ = DestroyIcon(hicon);
    result
}

fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

/// Returns the icon as a data URL, or None when it cannot be loaded.
#[tauri::command(async)]
pub fn get_icon(path: String) -> Option<String> {
    let (file, index) = parse_icon_spec(&path);
    let p = Path::new(&file);
    if !p.is_file() {
        return None;
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" => {
            let md = std::fs::metadata(p).ok()?;
            if md.len() > 2 * 1024 * 1024 {
                return None;
            }
            let bytes = std::fs::read(p).ok()?;
            let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
            Some(data_url(mime, &bytes))
        }
        _ => {
            let (w, h, rgba) = unsafe { extract_rgba(&file, index) }?;
            Some(data_url("image/png", &encode_png(w, h, &rgba)?))
        }
    }
}
