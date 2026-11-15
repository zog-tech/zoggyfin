//! The video surface on Windows. libmpv draws with its own renderer (`wid`,
//! `vo=gpu-next`, Direct3D 11) into a borderless window *behind* the main window.
//! The main window is transparent (`transparent: true`), and while the player is
//! open the page is transparent too, so the video shows through and the Zoggyfin
//! controls draw over it, as on macOS (`view_macos.rs`).
//!
//! Why not a child window under the web view: Windows clips a child window to the
//! part that its siblings above leave free. The web view's host windows cover the
//! whole client area, so a child video window under them never shows, however
//! transparent the page is.
//!
//! The video window owns the main window (`GWLP_HWNDPARENT`): Windows always keeps an
//! owned window above its owner, so the pair moves through the z-order together and
//! the video stays right under the page. The video window never takes focus, is not in
//! the taskbar or Alt+Tab, and lets mouse clicks through. It follows the main window's
//! client area (`fit`, on every move and resize) and hides while the main window is
//! minimized.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetClientRect, IsIconic, IsWindowVisible, RegisterClassW, SetWindowLongPtrW,
    SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW, GWLP_HWNDPARENT, MA_NOACTIVATE, SWP_NOACTIVATE,
    SWP_NOOWNERZORDER, SW_HIDE, SW_SHOWNOACTIVATE, WM_MOUSEACTIVATE, WM_NCHITTEST, WNDCLASSW, WS_CLIPCHILDREN,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

use super::Mpv;

const CLASS: PCWSTR = w!("ZoggyfinVideo");
/// `HTTRANSPARENT`: mouse input goes to the window under this one (never to the video).
const HT_TRANSPARENT: isize = -1;

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_NCHITTEST => LRESULT(HT_TRANSPARENT),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// The window handles as integers: `HWND` is not `Send`, and the view is shared
/// with the libmpv event thread.
pub struct VideoView {
    hwnd: isize,
    main: isize,
    /// The player is open (`set_visible(true)`), whether or not the main window is minimized.
    wanted: AtomicBool,
}

impl VideoView {
    fn hwnd(&self) -> HWND {
        HWND(self.hwnd as _)
    }

    fn main(&self) -> HWND {
        HWND(self.main as _)
    }

    /// Makes the video window behind `main` and gives it to libmpv. Main thread.
    pub fn attach(main: isize, mpv: Arc<Mpv>) -> Result<Self, String> {
        // SAFETY: plain Win32 window setup on the main thread; every handle is checked.
        unsafe {
            let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
            let instance = HINSTANCE(module.0);
            let class = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(wndproc),
                hInstance: instance,
                // Black where libmpv has no frame (nothing loaded, or between files).
                hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
                lpszClassName: CLASS,
                ..Default::default()
            };
            // 0 also when the class exists already (a second attach): CreateWindowExW checks.
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                CLASS,
                w!("Zoggyfin video"),
                WS_POPUP | WS_CLIPCHILDREN,
                0,
                0,
                1,
                1,
                None,
                None,
                Some(instance),
                None,
            )
            .map_err(|e| format!("the video window: {e}"))?;
            let main = HWND(main as _);
            // The main window becomes owned by the video window: always right above it.
            SetWindowLongPtrW(main, GWLP_HWNDPARENT, hwnd.0 as isize);
            let view = VideoView {
                hwnd: hwnd.0 as isize,
                main: main.0 as isize,
                wanted: AtomicBool::new(false),
            };
            view.fit();
            // libmpv makes its own window inside this one when a video starts.
            mpv.set("wid", &view.hwnd.to_string())?;
            Ok(view)
        }
    }

    /// Shows the video behind the page (the player is open) or hides it. Main thread.
    pub fn set_visible(&self, visible: bool) {
        self.wanted.store(visible, Ordering::Relaxed);
        self.fit();
    }

    /// Covers the main window's client area, on screen. Hidden while the player is closed
    /// or the main window is minimized. Main thread, after a move or a resize.
    pub fn fit(&self) {
        // SAFETY: window handles of this view and the main window.
        unsafe {
            let show = self.wanted.load(Ordering::Relaxed)
                && IsWindowVisible(self.main()).as_bool()
                && !IsIconic(self.main()).as_bool();
            if !show {
                let _ = ShowWindow(self.hwnd(), SW_HIDE);
                return;
            }
            let mut rect = RECT::default();
            if GetClientRect(self.main(), &mut rect).is_err() {
                return;
            }
            let mut origin = POINT::default();
            let _ = ClientToScreen(self.main(), &mut origin);
            // Right under the main window in the z-order, at the client area.
            let _ = SetWindowPos(
                self.hwnd(),
                Some(self.main()),
                origin.x,
                origin.y,
                rect.right - rect.left,
                rect.bottom - rect.top,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
            let _ = ShowWindow(self.hwnd(), SW_SHOWNOACTIVATE);
        }
    }
}
