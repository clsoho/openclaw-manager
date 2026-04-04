import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { Loader2, Wifi, WifiOff, ExternalLink, Play } from 'lucide-react';

interface EndpointStatus {
  enabled: boolean;
  gateway_running: boolean;
  has_token: boolean;
}

/**
 * Chat panel that embeds the OpenClaw Gateway control UI via iframe.
 * 
 * Tauri WebView ignores X-Frame-Options, so the Gateway UI at 
 * http://127.0.0.1:18789/ can be embedded directly.
 */
export function Chat() {
  const [gatewayUrl, setGatewayUrl] = useState<string | null>(null);
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const status = await invoke<EndpointStatus>('get_chat_endpoint_status');
      setGatewayRunning(status.gateway_running);

      if (status.gateway_running && status.enabled) {
        const token = await invoke<string>('get_chat_token');
        const url = token
          ? `http://127.0.0.1:18789/?token=${encodeURIComponent(token)}`
          : `http://127.0.0.1:18789/`;
        setGatewayUrl(url);
      }
    } catch (e) {
      console.warn('[Chat] Failed to check status:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartGateway() {
    setStarting(true);
    setStartError(null);
    try {
      const result = await invoke<string>('start_gateway');
      if (!result.startsWith('OK')) {
        throw new Error(result);
      }
      // Wait for Gateway to be ready
      await new Promise(resolve => setTimeout(resolve, 2000));
      await checkStatus();
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="relative w-full h-full bg-[#0d1117] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#30363d] bg-[#161b22]">
        <div className="flex items-center gap-1.5">
          {gatewayRunning ? (
            <Wifi className="w-4 h-4 text-green-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-orange-400" />
          )}
          <span className="text-sm text-[#c9d1d9] font-medium">
            {gatewayRunning ? 'OpenClaw 聊天' : 'Gateway 未启动'}
          </span>
        </div>
        {gatewayUrl && (
          <button
            onClick={() => window.open('http://127.0.0.1:18789/', '_blank')}
            className="ml-auto text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors"
            title="在新窗口打开"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d1117]">
            <div className="text-center">
              <Loader2 className="w-8 h-8 text-[#58a6ff] animate-spin mx-auto mb-3" />
              <p className="text-[#8b949e] text-sm">检查 Gateway 状态...</p>
            </div>
          </div>
        )}

        {/* Gateway not running */}
        {!loading && !gatewayRunning && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-[#0d1117]"
          >
            <div className="text-center max-w-sm px-6">
              <div className="w-16 h-16 rounded-2xl bg-[#161b22] border border-[#30363d] flex items-center justify-center mx-auto mb-4">
                <WifiOff className="w-8 h-8 text-[#f0883e]" />
              </div>
              <h3 className="text-lg font-semibold text-[#c9d1d9] mb-2">
                Gateway 未运行
              </h3>
              <p className="text-sm text-[#8b949e] mb-6">
                需要启动 OpenClaw Gateway 才能使用聊天功能
              </p>
              <button
                onClick={handleStartGateway}
                disabled={starting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {starting ? '启动中...' : '启动 Gateway'}
              </button>
              {startError && (
                <p className="mt-3 text-xs text-red-400">{startError}</p>
              )}
            </div>
          </motion.div>
        )}

        {/* iframe */}
        {!loading && gatewayRunning && gatewayUrl && (
          <iframe
            src={gatewayUrl}
            className="absolute inset-0 w-full h-full border-0 bg-[#0d1117]"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ display: 'block' }}
          />
        )}
      </div>
    </div>
  );
}
