// The nearby transport (Swift, macOS): swift/build_nearby.rs.
#[path = "swift/build_nearby.rs"]
mod build_nearby;

fn main() {
    build_nearby::build();
    println!("cargo:rerun-if-env-changed=MPV_LIB_DIR");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        windows_libmpv();
    } else {
        macos_libmpv();
    }
    tauri_build::build()
}

fn macos_libmpv() {
    // libmpv: Homebrew for development (see desktop/README.md). MPV_LIB_DIR overrides it;
    // the release build points it at the LGPL build of desktop/scripts/build-libmpv.sh.
    let dir = std::env::var("MPV_LIB_DIR").unwrap_or_else(|_| "/opt/homebrew/lib".into());
    println!("cargo:rustc-link-search=native={dir}");
    // The bundled libmpv has an @rpath install name and lives in Contents/Frameworks.
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    // Debug builds also find the LGPL build where it is, without a bundle.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
    }
}

/// Windows links `libmpv-2.dll` by name (`raw-dylib` in src/mpv/ffi.rs): no import library.
/// The DLL must sit next to the executable, so it is copied into the target folder.
/// MPV_LIB_DIR overrides the folder (default: `desktop/libmpv-windows`, from
/// `desktop/scripts/windows/setup-libmpv.ps1`).
fn windows_libmpv() {
    use std::path::PathBuf;
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let dir = std::env::var("MPV_LIB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest.join("../libmpv-windows"));
    let dll = dir.join("libmpv-2.dll");
    println!("cargo:rerun-if-changed={}", dll.display());
    if !dll.exists() {
        println!(
            "cargo:warning=no libmpv-2.dll in {}: run desktop/scripts/windows/setup-libmpv.ps1 (Zoggyfin.exe does not start without the DLL)",
            dir.display()
        );
        return;
    }
    // OUT_DIR is <target>/<profile>/build/<crate>-<hash>/out: the executable is three folders up.
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    if let Some(exe_dir) = out.ancestors().nth(3) {
        let to = exe_dir.join("libmpv-2.dll");
        // A new libmpv build can have the same size, so the time counts too.
        let fresh = std::fs::metadata(&to)
            .and_then(|t| {
                let from = std::fs::metadata(&dll)?;
                Ok(t.len() == from.len() && t.modified()? >= from.modified()?)
            })
            .unwrap_or(false);
        if !fresh {
            if let Err(e) = std::fs::copy(&dll, &to) {
                println!("cargo:warning=copy libmpv-2.dll to {}: {e}", to.display());
            }
        }
    }
}
