use std::env;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 获取操作系统类型
pub fn get_os() -> String {
    env::consts::OS.to_string()
}

/// 获取系统架构
pub fn get_arch() -> String {
    env::consts::ARCH.to_string()
}

/// 获取配置目录路径
pub fn get_config_dir() -> String {
    get_config_dir_path().display().to_string()
}

/// 获取配置目录 PathBuf，供内部文件操作使用。
pub fn get_config_dir_path() -> PathBuf {
    let native_path = get_native_config_dir_path();

    if is_windows() && !has_openclaw_config(&native_path) {
        for wsl_path in get_wsl_config_dir_paths() {
            if has_openclaw_config(&wsl_path) {
                return wsl_path;
            }
        }
    }

    native_path
}

fn get_native_config_dir_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".openclaw")
}

fn has_openclaw_config(path: &PathBuf) -> bool {
    path.join("env").exists() || path.join("openclaw.json").exists()
}

/// 获取环境变量文件路径
pub fn get_env_file_path() -> String {
    get_config_dir_path().join("env").display().to_string()
}

/// 获取 openclaw.json 配置文件路径
pub fn get_config_file_path() -> String {
    get_config_dir_path()
        .join("openclaw.json")
        .display()
        .to_string()
}

/// 获取 OpenClaw 主 Agent 的模型认证 Profile 文件路径
pub fn get_auth_profiles_file_path() -> String {
    env::var("OPENCLAW_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| get_config_dir_path())
        .join("agents")
        .join("main")
        .join("agent")
        .join("auth-profiles.json")
        .display()
        .to_string()
}

/// 获取日志文件路径
pub fn get_log_file_path() -> String {
    get_logs_dir_path()
        .join("gateway.err.log")
        .display()
        .to_string()
}

/// 获取日志目录路径
pub fn get_logs_dir_path() -> PathBuf {
    get_config_dir_path().join("logs")
}

/// 检测当前平台是否为 macOS
pub fn is_macos() -> bool {
    env::consts::OS == "macos"
}

/// 检测当前平台是否为 Windows
pub fn is_windows() -> bool {
    env::consts::OS == "windows"
}

/// 检测当前平台是否为 Linux
pub fn is_linux() -> bool {
    env::consts::OS == "linux"
}

fn run_wsl_query(script: &str) -> Option<String> {
    if !is_windows() {
        return None;
    }

    let mut command = Command::new("wsl");
    command.args(["-e", "bash", "-lc", script]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn get_wsl_distro_name() -> Option<String> {
    run_wsl_query("printf '%s' \"$WSL_DISTRO_NAME\"")
}

fn get_wsl_home_dir() -> Option<String> {
    run_wsl_query("printf '%s' \"$HOME\"")
}

fn wsl_linux_path_to_unc(host: &str, distro: &str, linux_path: &str) -> PathBuf {
    let relative_path = linux_path.trim_matches('/').replace('/', "\\");

    if relative_path.is_empty() {
        PathBuf::from(format!(r"\\{}\{}", host, distro))
    } else {
        PathBuf::from(format!(r"\\{}\{}\{}", host, distro, relative_path))
    }
}

fn get_wsl_config_dir_paths() -> Vec<PathBuf> {
    let Some(distro) = get_wsl_distro_name() else {
        return vec![];
    };
    let Some(home) = get_wsl_home_dir() else {
        return vec![];
    };
    let config_path = format!("{}/.openclaw", home);

    vec![
        wsl_linux_path_to_unc("wsl.localhost", &distro, &config_path),
        wsl_linux_path_to_unc("wsl$", &distro, &config_path),
    ]
}
