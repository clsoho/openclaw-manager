use crate::utils::file;
use crate::utils::platform;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::ffi::OsString;
use std::io;
use std::process::{Command, Output};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW 标志，用于隐藏控制台窗口
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const WSL_OPENCLAW_SENTINEL: &str = "wsl://openclaw";

fn get_wsl_command_path(cmd: &str) -> Option<String> {
    if !platform::is_windows() {
        return None;
    }

    let escaped_cmd = shell_escape_single_quotes(cmd);
    let script = format!("command -v '{}' 2>/dev/null", escaped_cmd);
    let output = run_wsl_bash_output(&script).ok()?;
    let path = output.lines().find(|line| !line.trim().is_empty())?.trim();

    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

fn run_wsl_bash(script: &str) -> io::Result<Output> {
    let mut command = Command::new("wsl");
    command.args(["-e", "bash", "-lc", script]);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command.output()
}

pub fn run_wsl_bash_output(script: &str) -> Result<String, String> {
    match run_wsl_bash(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    Err(format!(
                        "Command failed with exit code: {:?}",
                        output.status.code()
                    ))
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn shell_escape_single_quotes(value: &str) -> String {
    value.replace('\'', r#"'\''"#)
}

fn build_wsl_openclaw_script(args: &[&str]) -> String {
    let mut parts = vec!["openclaw".to_string()];
    parts.extend(
        args.iter()
            .map(|arg| format!("'{}'", shell_escape_single_quotes(arg))),
    );
    format!(
        "source ~/.openclaw/env 2>/dev/null || true; {}",
        parts.join(" ")
    )
}

fn is_wsl_openclaw_path(path: &str) -> bool {
    path == WSL_OPENCLAW_SENTINEL
}

/// 获取扩展的 PATH 环境变量
/// GUI 应用启动时可能没有继承用户 shell 的 PATH，需要手动添加常见路径
pub fn get_extended_path() -> String {
    let mut paths = Vec::<String>::new();

    // 添加常见的可执行文件路径
    paths.push("/opt/homebrew/bin".to_string()); // Homebrew on Apple Silicon
    paths.push("/usr/local/bin".to_string()); // Homebrew on Intel / 常规安装
    paths.push("/usr/bin".to_string());
    paths.push("/bin".to_string());

    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();

        // nvm 路径（尝试获取当前版本）
        let nvm_default = format!("{}/.nvm/alias/default", home_str);
        if let Ok(version) = std::fs::read_to_string(&nvm_default) {
            let version = version.trim();
            if !version.is_empty() {
                paths.insert(
                    0,
                    format!("{}/.nvm/versions/node/v{}/bin", home_str, version),
                );
            }
        }
        // 动态扫描 nvm 已安装版本目录，避免 PATH 只覆盖写死版本
        let nvm_versions_dir = std::path::Path::new(&home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_versions_dir) {
            let mut bins = Vec::new();
            for entry in entries.flatten() {
                let nvm_bin = entry.path().join("bin");
                if nvm_bin.exists() {
                    bins.push(nvm_bin.display().to_string());
                }
            }
            bins.sort();
            bins.reverse();
            for bin in bins {
                paths.push(bin);
            }
        }

        // 也添加常见 nvm 版本路径作为兜底
        for version in ["v22.22.0", "v22.12.0", "v22.11.0", "v22.0.0", "v23.0.0"] {
            paths.push(format!("{}/.nvm/versions/node/{}/bin", home_str, version));
        }

        // fnm
        paths.push(format!("{}/.fnm/aliases/default/bin", home_str));

        // volta
        paths.push(format!("{}/.volta/bin", home_str));

        // asdf
        paths.push(format!("{}/.asdf/shims", home_str));

        // mise
        paths.push(format!("{}/.local/share/mise/shims", home_str));
    }

    if platform::is_windows() {
        if let Ok(wsl_path) = run_wsl_bash_output("printf '%s' \"$PATH\"") {
            if !wsl_path.is_empty() {
                paths.push(wsl_path);
            }
        }
    }

    // 获取当前 PATH 并合并
    let current_path = std::env::var("PATH").unwrap_or_default();
    if !current_path.is_empty() {
        paths.push(current_path);
    }

    let separator = if platform::is_windows() { ";" } else { ":" };
    paths.join(separator)
}

fn get_gateway_token_from_env() -> String {
    file::read_env_value(&platform::get_env_file_path(), "OPENCLAW_GATEWAY_TOKEN")
        .filter(|token| !token.is_empty())
        .unwrap_or_else(|| DEFAULT_GATEWAY_TOKEN.to_string())
}

fn apply_openclaw_env(cmd: &mut Command, user_env_vars: &HashMap<String, String>) {
    for (key, value) in user_env_vars {
        cmd.env(key, value);
    }

    let token = user_env_vars
        .get("OPENCLAW_GATEWAY_TOKEN")
        .filter(|token| !token.is_empty())
        .cloned()
        .unwrap_or_else(get_gateway_token_from_env);

    cmd.env("PATH", get_extended_path());
    cmd.env("OPENCLAW_GATEWAY_TOKEN", token);
}

/// 执行 Shell 命令（带扩展 PATH）
pub fn run_command(cmd: &str, args: &[&str]) -> io::Result<Output> {
    let mut command = Command::new(cmd);
    command.args(args);

    // 在非 Windows 系统上使用扩展的 PATH
    #[cfg(not(windows))]
    {
        let extended_path = get_extended_path();
        command.env("PATH", extended_path);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command.output()
}

/// 执行 Shell 命令并获取输出字符串
pub fn run_command_output(cmd: &str, args: &[&str]) -> Result<String, String> {
    match run_command(cmd, args) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 Bash 命令（带扩展 PATH）
pub fn run_bash(script: &str) -> io::Result<Output> {
    let mut command = Command::new("bash");
    command.arg("-c").arg(script);

    // 在非 Windows 系统上使用扩展的 PATH
    #[cfg(not(windows))]
    {
        let extended_path = get_extended_path();
        command.env("PATH", extended_path);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command.output()
}

/// 执行 Bash 命令并获取输出
pub fn run_bash_output(script: &str) -> Result<String, String> {
    match run_bash(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    Err(format!(
                        "Command failed with exit code: {:?}",
                        output.status.code()
                    ))
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 cmd.exe 命令（Windows）- 避免 PowerShell 执行策略问题
pub fn run_cmd(script: &str) -> io::Result<Output> {
    let mut cmd = Command::new("cmd");
    cmd.args(["/c", script]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.output()
}

/// 执行 cmd.exe 命令并获取输出（Windows）
pub fn run_cmd_output(script: &str) -> Result<String, String> {
    match run_cmd(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if stdout.is_empty() {
                        Err(format!(
                            "Command failed with exit code: {:?}",
                            output.status.code()
                        ))
                    } else {
                        Err(stdout)
                    }
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 执行 PowerShell 命令（Windows）- 仅在需要 PowerShell 特定功能时使用
/// 注意：某些 Windows 系统的 PowerShell 执行策略可能禁止运行脚本
pub fn run_powershell(script: &str) -> io::Result<Output> {
    let mut cmd = Command::new("powershell");
    // 使用 -ExecutionPolicy Bypass 绕过执行策略限制
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.output()
}

/// 执行 PowerShell 命令并获取输出（Windows）
pub fn run_powershell_output(script: &str) -> Result<String, String> {
    match run_powershell(script) {
        Ok(output) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if stderr.is_empty() {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if stdout.is_empty() {
                        Err(format!(
                            "Command failed with exit code: {:?}",
                            output.status.code()
                        ))
                    } else {
                        Err(stdout)
                    }
                } else {
                    Err(stderr)
                }
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// 跨平台执行脚本命令
/// Windows 上使用 cmd.exe（避免 PowerShell 执行策略问题）
pub fn run_script_output(script: &str) -> Result<String, String> {
    if platform::is_windows() {
        run_cmd_output(script)
    } else {
        run_bash_output(script)
    }
}

/// 后台执行命令（不等待结果）
pub fn spawn_background(script: &str) -> io::Result<()> {
    if platform::is_windows() {
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", script]);

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.spawn()?;
    } else {
        Command::new("bash").arg("-c").arg(script).spawn()?;
    }
    Ok(())
}

/// 获取 openclaw 可执行文件路径
/// 检测多个可能的安装路径，因为 GUI 应用不继承用户 shell 的 PATH
pub fn get_openclaw_path() -> Option<String> {
    // Windows: 检查常见的 npm 全局安装路径
    if platform::is_windows() {
        let possible_paths = get_windows_openclaw_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                info!("[Shell] 在 {} 找到 openclaw", path);
                return Some(path);
            }
        }
    } else {
        // Unix: 检查常见的 npm 全局安装路径
        let possible_paths = get_unix_openclaw_paths();
        for path in possible_paths {
            if std::path::Path::new(&path).exists() {
                info!("[Shell] 在 {} 找到 openclaw", path);
                return Some(path);
            }
        }
    }

    // 回退：通过 cmd.exe / where 命令查找（比 command_exists 更可靠，因为能拿到实际路径）
    if platform::is_windows() {
        if let Ok(where_output) = run_cmd_output("where openclaw") {
            let first_line = where_output.lines().find(|l| !l.trim().is_empty());
            if let Some(path) = first_line {
                let path = path.trim();
                if std::path::Path::new(path).exists() {
                    info!("[Shell] 通过 where 找到 openclaw: {}", path);
                    return Some(path.to_string());
                }
            }
        }
    } else {
        // Unix 回退
        if command_exists("openclaw") {
            return Some("openclaw".to_string());
        }
    }

    // 最后尝试：通过用户 shell 查找
    if !platform::is_windows() {
        if let Ok(path) = run_bash_output("source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; which openclaw 2>/dev/null") {
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                info!("[Shell] 通过用户 shell 找到 openclaw: {}", path);
                return Some(path);
            }
        }
    } else if let Some(path) = get_wsl_command_path("openclaw") {
        info!("[Shell] 通过 WSL 找到 openclaw: {}", path);
        return Some(WSL_OPENCLAW_SENTINEL.to_string());
    }

    None
}

/// 获取 Unix 系统上可能的 openclaw 安装路径
fn get_unix_openclaw_paths() -> Vec<String> {
    let mut paths = Vec::new();

    // npm 全局安装路径
    paths.push("/usr/local/bin/openclaw".to_string());
    paths.push("/opt/homebrew/bin/openclaw".to_string()); // Homebrew on Apple Silicon
    paths.push("/usr/bin/openclaw".to_string());

    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();

        // npm 全局安装到用户目录
        paths.push(format!("{}/.npm-global/bin/openclaw", home_str));

        // nvm 安装的 npm 全局包：优先 default alias，再动态扫描已安装版本
        let nvm_default = format!("{}/.nvm/alias/default", home_str);
        if let Ok(version) = std::fs::read_to_string(&nvm_default) {
            let version = version.trim();
            if !version.is_empty() {
                let normalized = if version.starts_with('v') {
                    version.to_string()
                } else {
                    format!("v{}", version)
                };
                paths.push(format!(
                    "{}/.nvm/versions/node/{}/bin/openclaw",
                    home_str, normalized
                ));
            }
        }

        let nvm_versions_dir = std::path::Path::new(&home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_versions_dir) {
            let mut version_paths = Vec::new();
            for entry in entries.flatten() {
                let openclaw_path = entry.path().join("bin/openclaw");
                if openclaw_path.exists() {
                    version_paths.push(openclaw_path.display().to_string());
                }
            }
            version_paths.sort();
            version_paths.reverse();
            paths.extend(version_paths);
        }

        // 常见回退版本
        for version in ["v22.22.0", "v22.12.0", "v22.11.0", "v22.0.0", "v23.0.0"] {
            paths.push(format!(
                "{}/.nvm/versions/node/{}/bin/openclaw",
                home_str, version
            ));
        }

        // fnm
        paths.push(format!("{}/.fnm/aliases/default/bin/openclaw", home_str));

        // volta
        paths.push(format!("{}/.volta/bin/openclaw", home_str));

        // pnpm 全局安装
        paths.push(format!("{}/.pnpm/bin/openclaw", home_str));
        paths.push(format!("{}/Library/pnpm/openclaw", home_str)); // macOS pnpm 默认路径

        // asdf
        paths.push(format!("{}/.asdf/shims/openclaw", home_str));

        // mise (formerly rtx)
        paths.push(format!("{}/.local/share/mise/shims/openclaw", home_str));

        // yarn 全局安装
        paths.push(format!("{}/.yarn/bin/openclaw", home_str));
        paths.push(format!(
            "{}/.config/yarn/global/node_modules/.bin/openclaw",
            home_str
        ));
    }

    paths
}

/// 获取 Windows 上可能的 openclaw 安装路径
fn get_windows_openclaw_paths() -> Vec<String> {
    let mut paths = Vec::new();

    // 0. 动态查询 npm 全局安装路径（最可靠的方式）
    //    先尝试 run_cmd (cmd.exe)，再尝试直接用 npm
    if let Ok(npm_prefix) = run_cmd_output("npm prefix -g") {
        let npm_prefix = npm_prefix.trim();
        if !npm_prefix.is_empty() {
            info!("[Shell] npm 全局路径: {}", npm_prefix);
            // openclaw.cmd (npm 在 Windows 上生成的入口)
            paths.push(format!("{}\\openclaw.cmd", npm_prefix));
            // openclaw (无扩展名，某些配置下可能存在)
            paths.push(format!("{}\\openclaw", npm_prefix));
            // openclaw.ps1 (PowerShell 入口)
            paths.push(format!("{}\\openclaw.ps1", npm_prefix));
        }
    }

    // 1. nvm4w 安装路径
    paths.push("C:\\nvm4w\\nodejs\\openclaw.cmd".to_string());

    // 2. 用户目录下的 npm 全局路径（默认 AppData\Roaming\npm）
    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();
        paths.push(format!("{}\\AppData\\Roaming\\npm\\openclaw.cmd", home_str));
        // 也检查 node_modules 下的 .bin
        paths.push(format!(
            "{}\\AppData\\Roaming\\npm\\node_modules\\openclaw\\bin\\openclaw",
            home_str
        ));
    }

    // 3. Program Files 下的 nodejs
    paths.push("C:\\Program Files\\nodejs\\openclaw.cmd".to_string());

    // 4. 常见的自定义 Node.js 安装目录
    paths.push("D:\\NodeJS\\node_global\\openclaw.cmd".to_string());
    paths.push("C:\\NodeJS\\node_global\\openclaw.cmd".to_string());
    paths.push("D:\\nodejs\\node_global\\openclaw.cmd".to_string());

    // 5. Scoop 安装路径
    if let Some(home) = dirs::home_dir() {
        let home_str = home.display().to_string();
        paths.push(format!(
            "{}\\scoop\\apps\\nodejs\\current\\openclaw.cmd",
            home_str
        ));
    }

    // 6. Chocolatey 安装路径
    paths.push("C:\\ProgramData\\chocolatey\\bin\\openclaw.cmd".to_string());

    paths
}

/// 执行 openclaw 命令并获取输出
pub fn run_openclaw(args: &[&str]) -> Result<String, String> {
    debug!("[Shell] 执行 openclaw 命令: {:?}", args);

    let openclaw_path = get_openclaw_path().ok_or_else(|| {
        warn!("[Shell] 找不到 openclaw 命令");
        "找不到 openclaw 命令，请确保已通过 npm install -g openclaw 安装".to_string()
    })?;

    debug!("[Shell] openclaw 路径: {}", openclaw_path);

    debug!("[Shell] 扩展 PATH: {}", get_extended_path());

    let user_env_vars = load_openclaw_env_vars();

    let output = if is_wsl_openclaw_path(&openclaw_path) {
        let script = build_wsl_openclaw_script(args);
        run_wsl_bash(&script)
    } else if openclaw_path.ends_with(".cmd") {
        // Windows: .cmd 文件需要通过 cmd /c 执行
        let mut cmd_args = Vec::<OsString>::new();
        cmd_args.push("/c".into());
        cmd_args.push(openclaw_path.clone().into());
        cmd_args.extend(args.iter().map(|arg| OsString::from(*arg)));
        let mut cmd = Command::new("cmd");
        cmd.args(&cmd_args);
        apply_openclaw_env(&mut cmd, &user_env_vars);

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.output()
    } else {
        let mut cmd = Command::new(&openclaw_path);
        cmd.args(args);
        apply_openclaw_env(&mut cmd, &user_env_vars);

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        cmd.output()
    };

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            debug!("[Shell] 命令退出码: {:?}", out.status.code());
            if out.status.success() {
                debug!("[Shell] 命令执行成功, stdout 长度: {}", stdout.len());
                Ok(stdout)
            } else {
                debug!("[Shell] 命令执行失败, stderr: {}", stderr);
                Err(format!("{}\n{}", stdout, stderr).trim().to_string())
            }
        }
        Err(e) => {
            warn!("[Shell] 执行 openclaw 失败: {}", e);
            Err(format!("执行 openclaw 失败: {}", e))
        }
    }
}

/// 默认的 Gateway Token
pub const DEFAULT_GATEWAY_TOKEN: &str = "openclaw-manager-local-token";

/// 默认 Gateway 端口，仅在配置和环境变量都未指定时使用。
pub const DEFAULT_GATEWAY_PORT: u16 = 18789;

fn parse_gateway_port(value: &serde_json::Value) -> Option<u16> {
    value
        .as_u64()
        .and_then(|port| u16::try_from(port).ok())
        .or_else(|| value.as_str().and_then(|port| port.parse::<u16>().ok()))
}

/// 获取 OpenClaw Gateway 端口。
/// 优先读取 ~/.openclaw/env 中的 OPENCLAW_GATEWAY_PORT，再读取 openclaw.json 中的常见端口配置。
pub fn get_gateway_port() -> u16 {
    if platform::is_windows() && get_wsl_command_path("openclaw").is_some() {
        let script = r#"
source ~/.openclaw/env 2>/dev/null || true
if [ -n "$OPENCLAW_GATEWAY_PORT" ]; then
  printf '%s' "$OPENCLAW_GATEWAY_PORT"
elif [ -f ~/.openclaw/openclaw.json ]; then
  node -e "const fs=require('fs'); const p=process.env.HOME+'/.openclaw/openclaw.json'; const c=JSON.parse(fs.readFileSync(p,'utf8')); const port=c?.gateway?.port ?? c?.gateway?.http?.port ?? c?.gateway?.server?.port; if (port) process.stdout.write(String(port));" 2>/dev/null
fi
"#;
        if let Ok(output) = run_wsl_bash_output(script) {
            if let Ok(port) = output.trim().parse::<u16>() {
                return port;
            }
        }
    }

    let env_path = platform::get_env_file_path();
    if let Some(port) = file::read_env_value(&env_path, "OPENCLAW_GATEWAY_PORT")
        .and_then(|port| port.parse::<u16>().ok())
    {
        return port;
    }

    let config_path = platform::get_config_file_path();
    if let Ok(content) = file::read_file(&config_path) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            for pointer in [
                "/gateway/port",
                "/gateway/http/port",
                "/gateway/server/port",
            ] {
                if let Some(port) = config.pointer(pointer).and_then(parse_gateway_port) {
                    return port;
                }
            }
        }
    }

    DEFAULT_GATEWAY_PORT
}

/// 从 ~/.openclaw/env 文件读取所有环境变量
/// 与 shell 脚本 `source ~/.openclaw/env` 行为一致
fn load_openclaw_env_vars() -> HashMap<String, String> {
    let mut env_vars = HashMap::new();
    let env_path = platform::get_env_file_path();

    if let Ok(content) = file::read_file(&env_path) {
        for line in content.lines() {
            let line = line.trim();
            // 跳过注释和空行
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // 解析 export KEY=VALUE 或 KEY=VALUE 格式
            let line = line.strip_prefix("export ").unwrap_or(line);
            if let Some((key, _value)) = line.split_once('=') {
                let key = key.trim();
                // 去除值周围的引号
                if let Some(value) = file::read_env_value(&env_path, key) {
                    env_vars.insert(key.to_string(), value);
                }
            }
        }
    }

    env_vars
}

/// 后台启动 openclaw gateway
/// 与 shell 脚本行为一致：先加载 env 文件，再启动 gateway
pub fn spawn_openclaw_gateway() -> io::Result<()> {
    info!("[Shell] 后台启动 openclaw gateway...");

    let openclaw_path = get_openclaw_path().ok_or_else(|| {
        warn!("[Shell] 找不到 openclaw 命令");
        io::Error::new(
            io::ErrorKind::NotFound,
            "找不到 openclaw 命令，请确保已通过 npm install -g openclaw 安装",
        )
    })?;

    info!("[Shell] openclaw 路径: {}", openclaw_path);

    // 加载用户的 env 文件环境变量（与 shell 脚本 source ~/.openclaw/env 一致）
    info!("[Shell] 加载用户环境变量...");
    let user_env_vars = load_openclaw_env_vars();
    info!("[Shell] 已加载 {} 个环境变量", user_env_vars.len());
    for key in user_env_vars.keys() {
        debug!("[Shell] - 环境变量: {}", key);
    }

    info!("[Shell] 扩展 PATH: {}", get_extended_path());

    // Windows 上 .cmd 文件需要通过 cmd /c 来执行
    // 设置环境变量 OPENCLAW_GATEWAY_TOKEN，这样所有子命令都能自动使用
    let port = get_gateway_port().to_string();

    let mut cmd = if is_wsl_openclaw_path(&openclaw_path) {
        info!("[Shell] WSL 模式: 使用 wsl -e bash -lc 执行");
        let mut c = Command::new("wsl");
        c.args([
            "-e",
            "bash",
            "-lc",
            &format!(
                "source ~/.openclaw/env 2>/dev/null || true; openclaw gateway --port {}",
                port
            ),
        ]);
        c
    } else if openclaw_path.ends_with(".cmd") {
        info!("[Shell] Windows 模式: 使用 cmd /c 执行");
        let mut c = Command::new("cmd");
        c.args(["/c", &openclaw_path, "gateway", "--port", &port]);
        c
    } else {
        info!("[Shell] Unix 模式: 直接执行");
        let mut c = Command::new(&openclaw_path);
        c.args(["gateway", "--port", &port]);
        c
    };

    // 注入用户环境变量、扩展 PATH 和 gateway token。
    apply_openclaw_env(&mut cmd, &user_env_vars);

    // Windows: 隐藏控制台窗口
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    // 将 stdout/stderr 重定向到日志文件，以便 get_logs 可以读取
    let logs_dir = platform::get_logs_dir_path();
    let _ = std::fs::create_dir_all(&logs_dir);

    let stdout_log_path = logs_dir.join("gateway.log");
    let stderr_log_path = logs_dir.join("gateway.err.log");

    info!(
        "[Shell] 日志输出到: {} / {}",
        stdout_log_path.display(),
        stderr_log_path.display()
    );

    if let Ok(stdout_file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_log_path)
    {
        cmd.stdout(std::process::Stdio::from(stdout_file));
    }
    if let Ok(stderr_file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_log_path)
    {
        cmd.stderr(std::process::Stdio::from(stderr_file));
    }

    info!("[Shell] 启动 gateway 进程...");
    let child = cmd.spawn();

    match child {
        Ok(c) => {
            info!("[Shell] ✓ Gateway 进程已启动, PID: {}", c.id());
            Ok(())
        }
        Err(e) => {
            warn!("[Shell] ✗ Gateway 启动失败: {}", e);
            Err(io::Error::new(
                e.kind(),
                format!("启动失败 (路径: {}): {}", openclaw_path, e),
            ))
        }
    }
}

/// 检查命令是否存在
pub fn command_exists(cmd: &str) -> bool {
    if platform::is_windows() {
        // Windows: 使用 where 命令
        let mut command = Command::new("where");
        command.arg(cmd);

        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let exists = command
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        exists || get_wsl_command_path(cmd).is_some()
    } else {
        // Unix: 使用 which 命令
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
