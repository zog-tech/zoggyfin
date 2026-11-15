//! Local server discovery for the first screen (`src/servers/discovery/`).
//!
//! - `discovery_udp`: Jellyfin's discovery protocol. A UDP datagram
//!   "who is JellyfinServer?" goes to port 7359 on the limited broadcast
//!   address and the directed broadcast of each interface. Each server
//!   answers with JSON; the web app parses it.
//! - `discovery_interfaces`: the IPv4 addresses of the Mac, for the HTTP scan.
//! - `discovery_lan_probe`: macOS 15 asks the user for local network access.
//!   Until the user allows it, a send to the local network fails with
//!   EHOSTUNREACH. The first probe shows the prompt.
//! - `discovery_open_settings`: opens Privacy & Security, Local Network.

use std::io::ErrorKind;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

use serde::Serialize;

const QUESTION: &[u8] = b"who is JellyfinServer?";
const PORT: u16 = 7359;
const MAX_ANSWERS: usize = 64;

#[derive(Serialize, Clone)]
pub struct Interface {
    name: String,
    address: Ipv4Addr,
    prefix: u32,
    #[serde(skip)]
    broadcast: Option<Ipv4Addr>,
}

/// The IPv4 interfaces that are up, not loopback.
#[cfg(unix)]
fn interfaces() -> Vec<Interface> {
    let mut out = Vec::new();
    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs fills `head` with a list that freeifaddrs releases below.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return out;
    }
    let mut cur = head;
    while !cur.is_null() {
        // SAFETY: `cur` is a node of the list from getifaddrs.
        let ifa = unsafe { &*cur };
        cur = ifa.ifa_next;
        let flags = ifa.ifa_flags as libc::c_int;
        if flags & libc::IFF_UP == 0 || flags & libc::IFF_LOOPBACK != 0 {
            continue;
        }
        if ifa.ifa_addr.is_null() || ifa.ifa_netmask.is_null() {
            continue;
        }
        // SAFETY: the pointers are not null and point to sockaddrs of the family read first.
        let (addr, mask) = unsafe {
            if (*ifa.ifa_addr).sa_family as libc::c_int != libc::AF_INET {
                continue;
            }
            let a = &*(ifa.ifa_addr as *const libc::sockaddr_in);
            let m = &*(ifa.ifa_netmask as *const libc::sockaddr_in);
            (u32::from_be(a.sin_addr.s_addr), u32::from_be(m.sin_addr.s_addr))
        };
        let broadcast = (flags & libc::IFF_BROADCAST != 0).then(|| Ipv4Addr::from(addr | !mask));
        // SAFETY: ifa_name is a C string owned by the list.
        let name = unsafe { std::ffi::CStr::from_ptr(ifa.ifa_name) }
            .to_string_lossy()
            .into_owned();
        out.push(Interface {
            name,
            address: Ipv4Addr::from(addr),
            prefix: mask.count_ones(),
            broadcast,
        });
    }
    // SAFETY: `head` came from getifaddrs.
    unsafe { libc::freeifaddrs(head) };
    out
}

#[cfg(not(unix))]
fn interfaces() -> Vec<Interface> {
    Vec::new()
}

fn targets() -> Vec<Ipv4Addr> {
    let mut out = vec![Ipv4Addr::BROADCAST];
    for b in interfaces().into_iter().filter_map(|i| i.broadcast) {
        if !out.contains(&b) {
            out.push(b);
        }
    }
    out
}

fn socket() -> std::io::Result<UdpSocket> {
    let s = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))?;
    s.set_broadcast(true)?;
    Ok(s)
}

/// The OS error of a send that the system refused (no route, or no local network access).
#[cfg(unix)]
const HOST_UNREACHABLE: i32 = libc::EHOSTUNREACH;
/// `WSAEHOSTUNREACH`: Winsock errors are not the C library's errno values.
#[cfg(windows)]
const HOST_UNREACHABLE: i32 = 10065;

/// Sends the question to every target. `Ok(true)` when one send went out;
/// `Ok(false)` when the system refused all of them with EHOSTUNREACH
/// (local network access is off, or the prompt is open).
fn send_all(s: &UdpSocket) -> std::io::Result<bool> {
    let mut sent = false;
    let mut last = None;
    for t in targets() {
        match s.send_to(QUESTION, SocketAddrV4::new(t, PORT)) {
            Ok(_) => sent = true,
            Err(e) => last = Some(e),
        }
    }
    match (sent, last) {
        (true, _) | (false, None) => Ok(true),
        (false, Some(e)) if e.raw_os_error() == Some(HOST_UNREACHABLE) => Ok(false),
        (false, Some(e)) => Err(e),
    }
}

#[derive(Serialize)]
pub struct UdpResult {
    answers: Vec<String>,
    /// True when the system refused the sends (local network access).
    blocked: bool,
}

fn udp(timeout: Duration) -> Result<UdpResult, String> {
    let s = socket().map_err(|e| e.to_string())?;
    if !send_all(&s).map_err(|e| e.to_string())? {
        return Ok(UdpResult {
            answers: Vec::new(),
            blocked: true,
        });
    }
    let deadline = Instant::now() + timeout;
    let mut answers: Vec<String> = Vec::new();
    let mut buf = [0u8; 4096];
    while answers.len() < MAX_ANSWERS {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        s.set_read_timeout(Some(left)).map_err(|e| e.to_string())?;
        match s.recv_from(&mut buf) {
            Ok((n, _)) => {
                let text = String::from_utf8_lossy(&buf[..n]).trim().to_string();
                // Our own broadcast comes back on some networks.
                if !text.is_empty() && text.as_bytes() != QUESTION && !answers.contains(&text) {
                    answers.push(text);
                }
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(UdpResult {
        answers,
        blocked: false,
    })
}

#[tauri::command]
pub async fn discovery_udp(timeout_ms: u64) -> Result<UdpResult, String> {
    let timeout = Duration::from_millis(timeout_ms.clamp(200, 10_000));
    tauri::async_runtime::spawn_blocking(move || udp(timeout))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn discovery_interfaces() -> Vec<Interface> {
    interfaces()
}

/// "ok": the local network is reachable; "blocked": the system refused the
/// send (no access yet); "error": no network or another error.
#[tauri::command]
pub fn discovery_lan_probe() -> &'static str {
    match socket().and_then(|s| send_all(&s)) {
        Ok(true) => "ok",
        Ok(false) => "blocked",
        Err(_) => "error",
    }
}

#[tauri::command]
pub fn discovery_open_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}
