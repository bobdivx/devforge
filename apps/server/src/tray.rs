//! Icône à côté de l’horloge (Windows et Linux installés).
//! Clic : ouvre la page. Clic droit : ouvrir, redémarrer, arrêter.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::watch;

const FLATPAK_APP_ID: &str = "io.github.bobdivx.DevForge";
const OPEN: &str = "open";
const RESTART: &str = "restart";
const STOP: &str = "stop";

pub fn start(url: &str) -> watch::Receiver<bool> {
    let (tx, rx) = watch::channel(false);
    if !tray_wanted() {
        return rx;
    }
    ensure_linux_autostart();
    let url = url.to_string();
    std::thread::Builder::new()
        .name("devforge-tray".into())
        .spawn(move || run_tray(url, tx))
        .ok();
    rx
}

pub async fn until_exit(mut flag: watch::Receiver<bool>) {
    let mut ctrl = std::pin::pin!(ctrl_c_or_pending());
    loop {
        tokio::select! {
            _ = &mut ctrl => break,
            changed = flag.changed() => {
                if changed.is_err() || *flag.borrow() {
                    break;
                }
            }
        }
    }
}

fn tray_wanted() -> bool {
    if std::env::var_os("DEVFORGE_NO_TRAY").is_some() {
        return false;
    }
    if std::path::Path::new("/.dockerenv").exists() {
        return false;
    }
    if std::env::var_os("DEVFORGE_FORCE_TRAY").is_some() {
        return true;
    }
    crate::paths::is_packaged_app()
}

async fn ctrl_c_or_pending() {
    if tokio::signal::ctrl_c().await.is_err() {
        std::future::pending::<()>().await;
    }
}

fn run_tray(url: String, shutdown: watch::Sender<bool>) {
    let Some((rgba, width, height)) = tray_icon_rgba() else {
        tracing::warn!("icône de barre des tâches illisible");
        return;
    };
    let icon = match tray_icon::Icon::from_rgba(rgba, width, height) {
        Ok(icon) => icon,
        Err(e) => {
            tracing::warn!(error = %e, "icône de barre des tâches refusée");
            return;
        }
    };

    let menu = tray_icon::menu::Menu::new();
    let open = tray_icon::menu::MenuItem::with_id(OPEN, "Ouvrir", true, None);
    let restart = tray_icon::menu::MenuItem::with_id(RESTART, "Redémarrer", true, None);
    let stop = tray_icon::menu::MenuItem::with_id(STOP, "Arrêter", true, None);
    if menu.append_items(&[&open, &restart, &stop]).is_err() {
        tracing::warn!("menu de la barre des tâches indisponible");
        return;
    }

    let builder = tray_icon::TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("DevForge")
        .with_icon(icon)
        .with_menu_on_left_click(false);
    // Même identité que l’assistant, pour que Windows garde l’icône visible.
    #[cfg(windows)]
    let builder = builder.with_guid(0x7C4E9A2B_1D6F_4E83_9A15_6B0C8F2D4E71);
    let _tray = {
        match builder.build() {
            Ok(tray) => tray,
            Err(e) => {
                tracing::warn!(error = %e, "icône de barre des tâches non affichée");
                return;
            }
        }
    };
    // Le menu référence ces entrées : elles doivent vivre autant que l’icône.
    let _held = (open, restart, stop);
    tracing::info!("icône DevForge à côté de l’horloge");

    #[cfg(windows)]
    let mut promoted = false;
    let menu_rx = tray_icon::menu::MenuEvent::receiver();
    let click_rx = tray_icon::TrayIconEvent::receiver();
    loop {
        #[cfg(windows)]
        {
            pump_messages();
            if !promoted {
                promoted = promote_tray_icon();
            }
        }
        while let Ok(event) = click_rx.try_recv() {
            if let tray_icon::TrayIconEvent::Click {
                button: tray_icon::MouseButton::Left,
                button_state: tray_icon::MouseButtonState::Up,
                ..
            }
            | tray_icon::TrayIconEvent::DoubleClick { .. } = event
            {
                crate::paths::open_browser(&url);
            }
        }
        while let Ok(event) = menu_rx.try_recv() {
            match event.id.0.as_str() {
                OPEN => crate::paths::open_browser(&url),
                RESTART => {
                    schedule_relaunch();
                    let _ = shutdown.send(true);
                    return;
                }
                STOP => {
                    let _ = shutdown.send(true);
                    return;
                }
                _ => {}
            }
        }
        if *shutdown.borrow() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn schedule_relaunch() {
    let result = relaunch_detached();
    if let Err(e) = result {
        tracing::warn!(error = %e, "redémarrage de DevForge impossible");
    }
}

fn relaunch_detached() -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe()?;
        let script = format!(
            "timeout /t 2 /nobreak >nul & start \"\" \"{}\" --background",
            exe.display()
        );
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        std::process::Command::new("cmd")
            .args(["/C", &script])
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        use std::process::Stdio;
        if std::env::var_os("FLATPAK_ID").is_some() {
            std::process::Command::new("flatpak-spawn")
                .args([
                    "--host",
                    "sh",
                    "-c",
                    "sleep 1; exec flatpak run --env=DEVFORGE_NO_BROWSER=1 io.github.bobdivx.DevForge",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            return Ok(());
        }
        let exe = std::env::current_exe()?;
        use std::os::unix::process::CommandExt;
        std::process::Command::new("sh")
            .arg("-c")
            .arg("sleep 1; exec \"$0\" --background")
            .arg(&exe)
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        Ok(())
    }
}

pub fn linux_autostart_desktop(app_id: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=DevForge\n\
         Comment=PaaS et builder auto-hébergé\n\
         Exec=flatpak run --env=DEVFORGE_NO_BROWSER=1 {app_id}\n\
         Icon={app_id}\n\
         Terminal=false\n\
         Categories=Development;Network;\n\
         X-GNOME-Autostart-enabled=true\n\
         X-GNOME-Autostart-Delay=3\n"
    )
}

fn ensure_linux_autostart() {
    if std::env::var_os("FLATPAK_ID").is_none() {
        return;
    }
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let path = PathBuf::from(home)
        .join(".config")
        .join("autostart")
        .join(format!("{FLATPAK_APP_ID}.desktop"));
    if path.is_file() {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, linux_autostart_desktop(FLATPAK_APP_ID)) {
        tracing::debug!(error = %e, path = %path.display(), "autostart Linux ignoré");
    }
}

fn tray_icon_rgba() -> Option<(Vec<u8>, u32, u32)> {
    decode_png(include_bytes!("../../../deploy/zimaos/icon.png"))
}

fn decode_png(bytes: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let raw = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => raw.to_vec(),
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity(raw.len() / 3 * 4);
            for px in raw.chunks_exact(3) {
                out.extend_from_slice(&[px[0], px[1], px[2], 255]);
            }
            out
        }
        _ => return None,
    };
    let (width, height) = (info.width, info.height);
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return None;
    }
    const EDGE: u32 = 64;
    if width > EDGE && height > EDGE && width % EDGE == 0 && height % EDGE == 0 {
        let scaled = downscale_rgba(&rgba, width, height, EDGE, EDGE);
        return Some((scaled, EDGE, EDGE));
    }
    Some((rgba, width, height))
}

fn downscale_rgba(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    let mut out = vec![0u8; (dw * dh * 4) as usize];
    for y in 0..dh {
        let sy = y * sh / dh;
        for x in 0..dw {
            let sx = x * sw / dw;
            let si = ((sy * sw + sx) * 4) as usize;
            let di = ((y * dw + x) * 4) as usize;
            out[di..di + 4].copy_from_slice(&src[si..si + 4]);
        }
    }
    out
}

#[cfg(windows)]
fn pump_messages() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };
    unsafe {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// Windows 11 range les nouvelles icônes dans le menu débordement. On les épingle
/// à côté de l’horloge dès que l’explorateur a créé la clé.
#[cfg(windows)]
fn promote_tray_icon() -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
        HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_DWORD,
    };

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe {
        use windows_sys::Win32::System::Registry::HKEY;
        let root = wide(r"Control Panel\NotifyIconSettings");
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            root.as_ptr(),
            0,
            KEY_READ | KEY_WRITE,
            &mut hkey,
        ) != 0
        {
            return false;
        }
        let mut found = false;
        let mut index = 0u32;
        loop {
            let mut name = [0u16; 256];
            let mut name_len = name.len() as u32;
            let rc = RegEnumKeyExW(
                hkey,
                index,
                name.as_mut_ptr(),
                &mut name_len,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if rc != 0 {
                break;
            }
            index += 1;
            let mut child: HKEY = std::ptr::null_mut();
            if RegOpenKeyExW(hkey, name.as_ptr(), 0, KEY_READ | KEY_WRITE, &mut child) != 0 {
                continue;
            }
            let value_name = wide("ExecutablePath");
            let mut buf = [0u16; 1024];
            let mut buf_bytes = (buf.len() * 2) as u32;
            let mut kind = 0u32;
            let q = RegQueryValueExW(
                child,
                value_name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                buf.as_mut_ptr() as *mut u8,
                &mut buf_bytes,
            );
            let path = if q == 0 {
                let n = (buf_bytes as usize / 2).saturating_sub(1);
                String::from_utf16_lossy(&buf[..n]).to_ascii_lowercase()
            } else {
                String::new()
            };
            if path.contains("devforge-server.exe") {
                let promoted = wide("IsPromoted");
                let one: u32 = 1;
                let _ = RegSetValueExW(
                    child,
                    promoted.as_ptr(),
                    0,
                    REG_DWORD,
                    &one as *const u32 as *const u8,
                    4,
                );
                found = true;
            }
            RegCloseKey(child);
        }
        RegCloseKey(hkey);
        found
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_stays_in_the_tray() {
        let desktop = linux_autostart_desktop(FLATPAK_APP_ID);
        assert!(desktop.contains("DEVFORGE_NO_BROWSER=1"));
        assert!(desktop.contains("flatpak run"));
        assert!(desktop.contains(FLATPAK_APP_ID));
        assert!(desktop.contains("X-GNOME-Autostart-enabled=true"));
    }

    #[test]
    fn brand_icon_decodes_to_square_rgba() {
        let (rgba, w, h) = decode_png(include_bytes!("../../../deploy/zimaos/icon.png")).unwrap();
        assert_eq!((w, h), (64, 64));
        assert_eq!(rgba.len(), 64 * 64 * 4);
    }

    #[test]
    fn tray_registers_next_to_the_clock() {
        if std::env::var_os("DEVFORGE_TRAY_SMOKE").is_none() {
            return;
        }
        let (tx, _rx) = watch::channel(false);
        let shutdown = tx.clone();
        let handle = std::thread::spawn(move || run_tray("http://127.0.0.1:8000".into(), tx));
        let needle = format!("org.kde.StatusNotifierItem-{}-", std::process::id());
        let mut seen = false;
        for _ in 0..25 {
            std::thread::sleep(Duration::from_millis(200));
            let listed = std::process::Command::new("busctl")
                .args(["--user", "--no-pager", "list"])
                .output();
            if let Ok(listed) = listed {
                let text = String::from_utf8_lossy(&listed.stdout);
                if text.contains(&needle) {
                    seen = true;
                    break;
                }
            }
        }
        let _ = shutdown.send(true);
        let _ = handle.join();
        assert!(seen, "icône absente du bus de session ({needle})");
    }
}
