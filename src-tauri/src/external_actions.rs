use std::process::{Command, Stdio};

fn checked_url(input: &str) -> Result<String, String> {
    let url = url::Url::parse(input).map_err(|_| "invalidUrl")?;
    if !matches!(url.scheme(), "http" | "https" | "mailto") { return Err("invalidUrl".into()); }
    Ok(url.to_string())
}
#[tauri::command]
pub async fn external_open_url(url: String) -> Result<(), String> {
    let url = checked_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let mut command = { let mut c = Command::new("rundll32.exe"); c.arg("url.dll,FileProtocolHandler"); c };
        #[cfg(target_os = "macos")]
        let mut command = Command::new("open");
        #[cfg(target_os = "linux")]
        let mut command = Command::new("xdg-open");
        let status = command.arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|_| "externalOpenFailed")?;
        if status.success() { Ok(()) } else { Err("externalOpenFailed".into()) }
    }).await.map_err(|_| "externalOpenFailed")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_executable_and_local_file_schemes() {
        for value in ["javascript:alert(1)","data:text/html,test","file:///etc/passwd","cmd.exe","../file"] { assert!(checked_url(value).is_err()); }
        for value in ["https://example.org/a?q=1&b=2","http://example.org/","mailto:hello@example.org"] { assert!(checked_url(value).is_ok()); }
    }
}
