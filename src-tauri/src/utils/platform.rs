use std::env;
use std::path::PathBuf;

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
    if let Some(home) = dirs::home_dir() {
        home.join(".openclaw").display().to_string()
    } else {
        String::from("~/.openclaw")
    }
}

/// 获取配置目录 PathBuf，供内部文件操作使用。
pub fn get_config_dir_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".openclaw")
}

/// 获取环境变量文件路径
pub fn get_env_file_path() -> String {
    get_config_dir_path().join("env").display().to_string()
}

/// 获取 openclaw.json 配置文件路径
pub fn get_config_file_path() -> String {
    get_config_dir_path().join("openclaw.json").display().to_string()
}

/// 获取日志文件路径
pub fn get_log_file_path() -> String {
    get_logs_dir_path().join("gateway.err.log").display().to_string()
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
