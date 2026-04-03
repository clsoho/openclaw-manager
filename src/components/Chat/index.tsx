import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import {
  Send,
  User,
  Loader2,
  Trash2,
  Square,
  ChevronDown,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Wifi,
  WifiOff,
  Settings,
  Zap,
  Play,
} from 'lucide-react';
import clsx from 'clsx';

// ============ 类型定义 ============

interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  isDefault: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agentId: string;
  streaming?: boolean;
}

interface GatewayStatus {
  running: boolean;
  token: string | null;
  connected: boolean;
}

interface EndpointStatus {
  enabled: boolean;
  gateway_running: boolean;
  has_token: boolean;
}

// ============ 主组件 ============

export function Chat({ initialAgentId }: { initialAgentId?: string } = {}) {

  // 状态
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('main');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [gateway, setGateway] = useState<GatewayStatus>({
    running: false,
    token: null,
    connected: false,
  });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus | null>(null);
  const [enablingEndpoint, setEnablingEndpoint] = useState(false);
  const [startingGateway, setStartingGateway] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 初始化：加载 Agent 列表和 Gateway 状态
  useEffect(() => {
    const init = async () => {
      try {
        // 获取 Agent 列表
        const agentList = await invoke<AgentInfo[]>('get_agents_list');
        setAgents(agentList);

        // 如果有 initialAgentId，使用它
        if (initialAgentId && agentList.some(a => a.id === initialAgentId)) {
          setSelectedAgent(initialAgentId);
        } else {
          // 否则使用默认 Agent
          const defaultAgent = agentList.find(a => a.isDefault);
          if (defaultAgent) setSelectedAgent(defaultAgent.id);
        }

        // 获取 Gateway Token
        try {
          const token = await invoke<string>('get_or_create_gateway_token');
          setGateway(prev => ({ ...prev, token }));
        } catch (e) {
          console.error('获取 Gateway Token 失败:', e);
        }

        // 检查 chat completions 端点状态
        try {
          const epStatus = await invoke<EndpointStatus>('get_chat_endpoint_status');
          setEndpointStatus(epStatus);
        } catch (e) {
          console.error('检查端点状态失败:', e);
        }
      } catch (e) {
        console.error('初始化失败:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [initialAgentId]);

  // 检查 Gateway 连接状态
  useEffect(() => {
    if (!gateway.token) return;

    const checkGateway = async () => {
      try {
        // 使用 /v1/models 端点检测 Gateway 是否可用
        const resp = await fetch('http://localhost:18789/v1/models', {
          headers: { Authorization: `Bearer ${gateway.token}` },
          signal: AbortSignal.timeout(3000),
        });
        setGateway(prev => ({
          ...prev,
          running: true,
          connected: resp.ok,
        }));
      } catch {
        setGateway(prev => ({
          ...prev,
          running: false,
          connected: false,
        }));
      }
    };

    checkGateway();
    const interval = setInterval(checkGateway, 10000);
    return () => clearInterval(interval);
  }, [gateway.token]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAgentDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 发送消息（流式）
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !gateway.token || sending) return;

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      agentId: selectedAgent,
    };

    // 添加助手占位消息
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agentId: selectedAgent,
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputText('');
    setSending(true);

    // 构建消息历史（最近 20 条）
    const recentMessages = [...messages, userMsg]
      .slice(-20)
      .map(m => ({
        role: m.role,
        content: m.content,
      }));

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const resp = await fetch('http://localhost:18789/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gateway.token}`,
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': selectedAgent,
        },
        body: JSON.stringify({
          model: 'openclaw',
          stream: true,
          messages: recentMessages,
        }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`Gateway ${resp.status}: ${errText}`);
      }

      if (!resp.body) {
        throw new Error('响应体为空');
      }

      // 处理 SSE 流
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulatedContent += delta;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: accumulatedContent }
                    : m
                )
              );
            }
          } catch {
            // 跳过无法解析的行
          }
        }
      }

      // 流结束，标记为非 streaming
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, streaming: false, content: accumulatedContent || '(无响应内容)' }
            : m
        )
      );

      // 如果 Gateway 之前标记为未连接，现在标记为已连接
      if (!gateway.connected) {
        setGateway(prev => ({ ...prev, connected: true, running: true }));
      }
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const isAbort = e instanceof DOMException && e.name === 'AbortError';

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsg.id
            ? {
                ...m,
                streaming: false,
                content: isAbort
                  ? '(已停止生成)'
                  : `⚠️ 请求失败: ${errorMsg}`,
              }
            : m
        )
      );

      if (!isAbort) {
        setGateway(prev => ({ ...prev, connected: false }));
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      inputRef.current?.focus();
    }
  };

  // 停止生成
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // 清空对话
  const handleClear = () => {
    setMessages([]);
  };

  // 启动 Gateway 服务
  const handleStartGateway = async () => {
    setStartingGateway(true);
    try {
      await invoke<string>('start_service');
      // 等待一会后重新检查连接
      setTimeout(async () => {
        const token = await invoke<string>('get_or_create_gateway_token').catch(() => null);
        if (token) setGateway(prev => ({ ...prev, token }));
        setStartingGateway(false);
      }, 3000);
    } catch (e) {
      console.error('启动 Gateway 失败:', e);
      setStartingGateway(false);
    }
  };

  // 一键启用 chat completions 端点
  const handleEnableEndpoint = async () => {
    setEnablingEndpoint(true);
    try {
      await invoke<string>('enable_chat_completions');
      // 重新检查状态
      const epStatus = await invoke<EndpointStatus>('get_chat_endpoint_status');
      setEndpointStatus(epStatus);
    } catch (e) {
      console.error('启用端点失败:', e);
    } finally {
      setEnablingEndpoint(false);
    }
  };

  // 按 Enter 发送
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 自动调整 textarea 高度
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const currentAgent = agents.find(a => a.id === selectedAgent);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-claw-500" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏：Agent 选择器 + 状态 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
        {/* Agent 下拉选择器 */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowAgentDropdown(!showAgentDropdown)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-card border border-edge transition-all"
          >
            <span className="text-lg">{currentAgent?.emoji || '🤖'}</span>
            <span className="text-sm font-medium text-content-primary">
              {currentAgent?.name || 'Agent'}
            </span>
            <ChevronDown size={14} className="text-content-tertiary" />
          </button>

          <AnimatePresence>
            {showAgentDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-2 w-64 bg-surface-sidebar rounded-xl border border-edge shadow-xl z-50 overflow-hidden"
              >
                <div className="p-2">
                  <p className="px-3 py-1.5 text-xs text-content-tertiary font-medium">切换 Agent</p>
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setSelectedAgent(agent.id);
                        setShowAgentDropdown(false);
                        // 切换 Agent 时清空对话
                        setMessages([]);
                      }}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left',
                        selectedAgent === agent.id
                          ? 'bg-claw-500/15 text-content-primary'
                          : 'text-content-secondary hover:bg-surface-elevated'
                      )}
                    >
                      <span className="text-lg">{agent.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{agent.name}</p>
                        <p className="text-xs text-content-tertiary truncate">{agent.id}</p>
                      </div>
                      {agent.isDefault && (
                        <Sparkles size={12} className="text-yellow-500 flex-shrink-0" />
                      )}
                      {selectedAgent === agent.id && (
                        <div className="w-2 h-2 rounded-full bg-claw-500 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 右侧状态和操作 */}
        <div className="flex items-center gap-2">
          {/* 连接状态 */}
          <div className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs',
            gateway.connected
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          )}>
            {gateway.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span>{gateway.connected ? '已连接' : '未连接'}</span>
          </div>

          {/* 清空按钮 */}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="p-2 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-surface-elevated transition-all"
              title="清空对话"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto scroll-container">
        {messages.length === 0 ? (
          // 空状态
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-claw-500/10 flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-claw-400" />
            </div>
            <h3 className="text-lg font-semibold text-content-primary mb-2">
              与 {currentAgent?.name || 'Agent'} 开始对话
            </h3>

            {/* 端点未启用提示 */}
            {gateway.connected && endpointStatus && !endpointStatus.enabled ? (
              <div className="max-w-sm space-y-4">
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 rounded-xl text-left">
                  <Settings size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-400 font-medium">Chat Completions 端点未启用</p>
                    <p className="text-xs text-content-tertiary mt-1">
                      需要在 Gateway 配置中启用 OpenAI 兼容的 chat completions HTTP 端点才能使用聊天功能。
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleEnableEndpoint}
                  disabled={enablingEndpoint}
                  className="btn-primary flex items-center gap-2 mx-auto"
                >
                  {enablingEndpoint ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Zap size={16} />
                  )}
                  {enablingEndpoint ? '启用中...' : '一键启用并重启 Gateway'}
                </button>
                <p className="text-xs text-content-tertiary">
                  启用后需要重启 Gateway 服务才能生效
                </p>
              </div>
            ) : (
              <>
                {!gateway.connected && !gateway.running ? (
                  <div className="max-w-sm space-y-4">
                    <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 rounded-xl text-left">
                      <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-amber-400 font-medium">Gateway 服务未运行</p>
                        <p className="text-xs text-content-tertiary mt-1">
                          聊天功能依赖 Gateway 服务，请先启动服务。
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleStartGateway}
                      disabled={startingGateway}
                      className="btn-primary flex items-center gap-2 mx-auto"
                    >
                      {startingGateway ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Play size={16} />
                      )}
                      {startingGateway ? '启动中...' : '启动 Gateway 服务'}
                    </button>
                  </div>
                ) : !gateway.connected ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 rounded-xl text-amber-400 text-sm">
                    <AlertCircle size={16} />
                    <span>Gateway 已运行但 API 不可达，请检查配置</span>
                  </div>
                ) : (
                  <p className="text-sm text-content-tertiary max-w-sm mb-6">
                    输入消息开始聊天，支持多轮对话。按 Enter 发送，Shift+Enter 换行。
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          // 消息列表
          <div className="max-w-3xl mx-auto py-6 px-4 space-y-4">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={clsx(
                  'flex gap-3',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-claw-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                    <span className="text-sm">{currentAgent?.emoji || '🤖'}</span>
                  </div>
                )}

                <div
                  className={clsx(
                    'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
                    msg.role === 'user'
                      ? 'bg-claw-600 text-white rounded-br-md'
                      : 'bg-surface-elevated text-content-primary rounded-bl-md'
                  )}
                >
                  {msg.content ? (
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  ) : msg.streaming ? (
                    <div className="flex items-center gap-2 text-content-tertiary">
                      <Loader2 size={14} className="animate-spin" />
                      <span>思考中...</span>
                    </div>
                  ) : null}
                  {msg.streaming && msg.content && (
                    <span className="inline-block w-1.5 h-4 ml-1 bg-claw-400 animate-pulse rounded-sm" />
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-lg bg-surface-elevated flex items-center justify-center flex-shrink-0 mt-1">
                    <User size={16} className="text-content-secondary" />
                  </div>
                )}
              </motion.div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-edge p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  gateway.connected
                    ? `发送消息给 ${currentAgent?.name || 'Agent'}...`
                    : 'Gateway 未连接...'
                }
                disabled={!gateway.connected}
                rows={1}
                className="w-full resize-none bg-surface-elevated text-content-primary text-sm rounded-xl px-4 py-3 pr-12 border border-edge focus:border-claw-500 focus:ring-1 focus:ring-claw-500/50 outline-none transition-all placeholder:text-content-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ maxHeight: '120px' }}
              />
            </div>

            {sending ? (
              <button
                onClick={handleStop}
                className="p-3 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all flex-shrink-0"
                title="停止生成"
              >
                <Square size={18} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || !gateway.connected}
                className="p-3 rounded-xl bg-claw-600 text-white hover:bg-claw-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
                title="发送"
              >
                <Send size={18} />
              </button>
            )}
          </div>

          {/* 提示文字 */}
          <p className="text-xs text-content-tertiary mt-2 text-center">
            Enter 发送 · Shift+Enter 换行 · 对话历史随会话保留
          </p>
        </div>
      </div>
    </div>
  );
}
