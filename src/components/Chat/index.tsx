import { useEffect, useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
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
  Brain,
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

  // ============ 状态 ============
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('main');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('openclaw');
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
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const [enablingEndpoint, setEnablingEndpoint] = useState(false);
  const [startingGateway, setStartingGateway] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);

  // ============ Refs ============
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // ============ 滚动 ============
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ============ 拉取 LLM 模型列表（从 openclaw.json agents.defaults.models 读取）============
  const fetchModels = useCallback(async (tkn: string) => {
    setLoadingModels(true);
    setModelFetchError(null);
    try {
      const modelIds = await invoke<string[]>('fetch_gateway_models', { token: tkn });
      setModels(modelIds);
      // 同步当前主模型配置
      try {
        const pm = await invoke<string>('get_primary_model');
        setSelectedModel(pm);
      } catch {
        if (!modelIds.includes(selectedModel) && modelIds.length > 0) {
          setSelectedModel(modelIds[0]);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setModelFetchError(`模型列表获取失败: ${msg}`);
    } finally {
      setLoadingModels(false);
    }
  }, [selectedModel]);

  // ============ 加载聊天历史 ============
  const loadChatHistory = useCallback(async (aid: string, tkn: string) => {
    try {
      const history = await invoke<any[]>('fetch_chat_history', {
        agentId: aid,
        token: tkn,
        limit: 50,
      });
      const historyMessages: ChatMessage[] = history.map((msg: any, idx: number) => ({
        id: `hist-${idx}-${msg.role || 'unknown'}`,
        role: msg.role === 'model' ? 'assistant' : (msg.role || 'assistant'),
        content: typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || '').join('')
            : String(msg.content || '')),
        timestamp: msg.timestamp || Date.now(),
        agentId: aid,
      }));
      if (historyMessages.length > 0) {
        setMessages(historyMessages);
        console.log(`[Chat] 加载 ${historyMessages.length} 条历史消息`);
      }
    } catch (e) {
      console.error('加载历史消息失败:', e);
    }
  }, []);

  // ============ 初始化 ============
  useEffect(() => {
    const init = async () => {
      try {
        // 获取 Gateway Token
        let token: string | null = null;
        try {
          token = await invoke<string>('get_or_create_gateway_token');
          setGateway(prev => ({ ...prev, token }));
        } catch (e) {
          console.error('获取 Gateway Token 失败:', e);
        }

        // 获取 Agent 列表
        const agentList = await invoke<AgentInfo[]>('get_agents_list');
        setAgents(agentList);
        console.log('[Chat] Agent 列表:', agentList);

        if (initialAgentId && agentList.some(a => a.id === initialAgentId)) {
          setSelectedAgent(initialAgentId);
        } else {
          const defaultAgent = agentList.find(a => a.isDefault);
          if (defaultAgent) setSelectedAgent(defaultAgent.id);
        }

        // 加载聊天历史
        if (token) {
          const targetAgent = initialAgentId || agentList.find(a => a.isDefault)?.id;
          if (targetAgent) {
            await loadChatHistory(targetAgent, token);
          }
        }

        // 获取模型列表（通过 Rust 代理）
        if (token) {
          await fetchModels(token);
          // 检查 Gateway 连通性
          try {
            const isRunning = await invoke<boolean>('check_gateway_running', { token });
            setGateway(prev => ({ ...prev, connected: isRunning, running: isRunning }));
          } catch {
            setGateway(prev => ({ ...prev, connected: false, running: false }));
          }
        }

        // 检查端点状态
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
  }, [initialAgentId, fetchModels, loadChatHistory]);

  // ============ Gateway 心跳检测（通过 Tauri 命令） ============
  useEffect(() => {
    if (!gateway.token) return;

    const checkGateway = async () => {
      try {
        const isRunning = await invoke<boolean>('check_gateway_running', { token: gateway.token });
        const wasConnected = gateway.connected;
        setGateway(prev => ({
          ...prev,
          running: isRunning,
          connected: isRunning,
        }));
        if (!wasConnected && isRunning) {
          fetchModels(gateway.token!);
        }
      } catch {
        setGateway(prev => ({
          ...prev,
          running: false,
          connected: false,
        }));
      }
    };

    checkGateway();
    const interval = setInterval(checkGateway, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.token, gateway.connected]);

  // ============ 点击外部关闭下拉 ============
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAgentDropdown(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ============ 停止生成 ============
  const handleStop = () => {
    currentRequestIdRef.current = null;
  };

  // ============ 发送消息（通过 Rust 代理，避免 WebView 跨域） ============
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || !gateway.token) return;

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    currentRequestIdRef.current = requestId;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      agentId: selectedAgent,
    };

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agentId: selectedAgent,
      streaming: true,
    };

    // 构建消息历史（最近 20 条）
    const recentMessages = [...messages, userMsg]
      .slice(-20)
      .map(m => ({
        role: m.role,
        content: m.content,
      }));

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInputText('');
    setSending(true);

    // 监听 Rust 端的流式事件
    const unlisten = await listen('chat-stream', (event: { payload: { request_id: string; content: string; done: boolean; error: string | null } }) => {
      const { request_id, content, done, error } = event.payload;
      if (request_id !== requestId) return;
      // 如果用户已取消，忽略后续事件
      if (currentRequestIdRef.current !== requestId) return;

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: content || m.content,
                streaming: !done,
                ...(done && !error ? { content: content || '(无响应内容)' } : {}),
                ...(error ? { content: `⚠️ ${error}`, streaming: false } : {}),
              }
            : m
        )
      );

      if (done) {
        setSending(false);
        currentRequestIdRef.current = null;
        inputRef.current?.focus();
        if (!error && !gateway.connected) {
          setGateway(prev => ({ ...prev, connected: true, running: true }));
        }
        if (error) {
          setGateway(prev => ({ ...prev, connected: false }));
        }
      }
    });

    try {
      await invoke<string>('send_chat_stream', {
        token: gateway.token,
        agentId: selectedAgent,
        model: selectedModel,
        messages: recentMessages,
        requestId,
      });
    } catch (e: unknown) {
      // 错误会通过事件传递，这里只是启动失败
      const errorMsg = e instanceof Error ? e.message : String(e);
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, streaming: false, content: `⚠️ 启动失败: ${errorMsg}` }
            : m
        )
      );
      setSending(false);
      currentRequestIdRef.current = null;
    } finally {
      // 清理监听器（延迟一点确保最后一条事件已处理）
      setTimeout(() => { unlisten(); }, 500);
    }
  };

  // ============ 清空对话 ============
  const handleClear = () => {
    setMessages([]);
  };

  // ============ 启动 Gateway ============
  const handleStartGateway = async () => {
    setStartingGateway(true);
    try {
      await invoke<string>('start_service');
      setTimeout(async () => {
        const token = await invoke<string>('get_or_create_gateway_token').catch(() => null);
        if (token) {
          setGateway(prev => ({ ...prev, token }));
          fetchModels(token);
        }
        setStartingGateway(false);
      }, 3000);
    } catch (e) {
      console.error('启动 Gateway 失败:', e);
      setStartingGateway(false);
    }
  };

  // ============ 启用端点 ============
  const handleEnableEndpoint = async () => {
    setEnablingEndpoint(true);
    try {
      await invoke<string>('enable_chat_completions');
      const epStatus = await invoke<EndpointStatus>('get_chat_endpoint_status');
      setEndpointStatus(epStatus);
    } catch (e) {
      console.error('启用端点失败:', e);
    } finally {
      setEnablingEndpoint(false);
    }
  };

  // ============ 切换 Agent ============
  const handleAgentChange = async (agentId: string) => {
    setSelectedAgent(agentId);
    setShowAgentDropdown(false);
    // 加载新 Agent 的历史消息
    if (gateway.token) {
      await loadChatHistory(agentId, gateway.token);
    } else {
      setMessages([]);
    }
  };

  // ============ 切换主模型（写入 openclaw.json 并重启 Gateway）============
  const [switchingModel, setSwitchingModel] = useState(false);
  const handleModelChange = async (modelId: string) => {
    setShowModelDropdown(false);
    if (modelId === selectedModel) return;
    setSwitchingModel(true);
    try {
      await invoke<string>('set_primary_model', { modelId });
      setSelectedModel(modelId);
      // 重启 Gateway 使新模型生效
      try {
        await invoke<string>('restart_service');
      } catch (e) {
        console.error('重启 Gateway 失败:', e);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setModelFetchError(`切换模型失败: ${msg}`);
    } finally {
      setSwitchingModel(false);
    }
  };

  // ============ 快捷键 ============
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const currentAgent = agents.find(a => a.id === selectedAgent);

  // 格式化模型名显示（去掉 openclaw/ 前缀更简洁）
  const formatModelLabel = (modelId: string) => {
    if (modelId === 'openclaw') return 'OpenClaw (默认)';
    if (modelId === 'openclaw/default') return 'Default Agent';
    if (modelId === 'openclaw/wokercoder') return 'WOkerCoder';
    // 其他直接显示 ID
    return modelId;
  };

  // ============ Loading 状态 ============
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-claw-500" />
      </div>
    );
  }

  // ============ 渲染 ============
  return (
    <div className="h-full flex flex-col">
      {/* ====== 顶栏 ====== */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge gap-2">
        {/* 左侧：Agent + 模型 选择器 */}
        <div className="flex items-center gap-2">
          {/* Agent 下拉 */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowAgentDropdown(!showAgentDropdown)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-card border border-edge transition-all"
              title="切换 Agent"
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
                        onClick={() => handleAgentChange(agent.id)}
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

          {/* 分隔线 */}
          <div className="w-px h-6 bg-edge" />

          {/* 模型下拉选择器 */}
          <div className="relative" ref={modelDropdownRef}>
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              disabled={loadingModels}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-elevated hover:bg-surface-card border border-edge transition-all',
                loadingModels && 'opacity-60 cursor-wait'
              )}
              title="切换模型"
            >
              <Brain size={16} className="text-claw-400" />
              <span className="text-sm font-medium text-content-primary max-w-40 truncate">
                {formatModelLabel(selectedModel)}
              </span>
              {loadingModels ? (
                <Loader2 size={12} className="animate-spin text-content-tertiary" />
              ) : (
                <ChevronDown size={14} className="text-content-tertiary" />
              )}
            </button>

            <AnimatePresence>
              {showModelDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 mt-2 w-80 bg-surface-sidebar rounded-xl border border-edge shadow-xl z-50 overflow-hidden"
                  style={{ maxHeight: 'min(350px, 60vh)' }}
                >
                  <div className="p-1">
                    <p className="px-2 py-1 text-xs text-content-tertiary font-medium flex items-center gap-1">
                      切换主模型
                      {switchingModel && <Loader2 size={10} className="animate-spin" />}
                      {modelFetchError && (
                        <span className="text-red-400 font-normal ml-1">（{modelFetchError}）</span>
                      )}
                    </p>
                    <div className="overflow-y-auto scroll-container" style={{ maxHeight: 'min(300px, 50vh)' }}>
                      {models.length === 0 && !loadingModels && !modelFetchError && (
                        <p className="px-2 py-3 text-xs text-content-tertiary text-center">
                          暂无可用模型
                        </p>
                      )}
                      {models.map(modelId => (
                        <button
                          key={modelId}
                          onClick={() => handleModelChange(modelId)}
                          disabled={switchingModel}
                          className={clsx(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-all',
                            switchingModel && 'pointer-events-none',
                            selectedModel === modelId
                              ? 'bg-claw-500/15 text-content-primary'
                              : 'text-content-secondary hover:bg-surface-elevated'
                          )}
                        >
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all"
                            style={{ backgroundColor: selectedModel === modelId ? 'var(--color-claw-500)' : 'transparent' }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{formatModelLabel(modelId)}</p>
                          </div>
                          {switchingModel && selectedModel === modelId && (
                            <Loader2 size={10} className="animate-spin text-claw-400 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                    {/* 刷新按钮 */}
                    <button
                      onClick={() => gateway.token && fetchModels(gateway.token)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 rounded text-xs text-content-tertiary hover:text-content-primary hover:bg-surface-elevated transition-all border-t border-edge"
                    >
                      <Loader2 size={12} className={loadingModels ? 'animate-spin' : ''} />
                      {loadingModels ? '刷新中...' : '刷新模型列表'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 右侧：连接状态 + 操作 */}
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

      {/* ====== 消息区域 ====== */}
      <div className="flex-1 overflow-y-auto scroll-container">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-claw-500/10 flex items-center justify-center mb-4">
              <MessageSquare size={28} className="text-claw-400" />
            </div>
            <h3 className="text-lg font-semibold text-content-primary mb-2">
              与 {currentAgent?.name || 'Agent'} 开始对话
            </h3>

            {/* 当前配置提示 */}
            <div className="flex flex-col items-center gap-1 mb-6">
              <p className="text-xs text-content-tertiary">
                Agent: <span className="text-content-secondary">{currentAgent?.name}</span>
                {' · '}
                模型: <span className="text-content-secondary">{formatModelLabel(selectedModel)}</span>
              </p>
              {models.length > 0 && (
                <p className="text-xs text-content-tertiary">
                  共 {models.length} 个可用模型
                </p>
              )}
            </div>

            {gateway.connected && endpointStatus && !endpointStatus.enabled ? (
              <div className="max-w-sm space-y-4">
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 rounded-xl text-left">
                  <Settings size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-400 font-medium">Chat Completions 端点未启用</p>
                    <p className="text-xs text-content-tertiary mt-1">
                      需要在 Gateway 配置中启用 OpenAI 兼容的 chat completions HTTP 端点。
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

      {/* ====== 输入区域 ====== */}
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
                    ? `发送消息给 ${currentAgent?.name || 'Agent'} (${formatModelLabel(selectedModel)})...`
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
