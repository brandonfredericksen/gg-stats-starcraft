//! A build script that gathers version information from package.json.

use std::fs;

fn main() {
    println!(
        "cargo:rustc-env=SHIELDBATTERY_VERSION={}",
        package_json_version("../package.json")
    );
}

fn package_json_version(path: &str) -> String {
    println!("cargo:rerun-if-changed={path}");
    let mut file = fs::File::open(path).unwrap();
    let json: serde_json::Value = serde_json::from_reader(&mut file).unwrap();
    json.as_object()
        .expect("package.json root not object")
        .get("version")
        .expect("package.json version not found")
        .as_str()
        .expect("package.json version not string")
        .into()
}
