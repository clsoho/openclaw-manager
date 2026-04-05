import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  Star,
  Settings2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Cpu,
  Server,
  Sparkles,
  Zap,
  CheckCircle,
  XCircle,
  Pencil,
  ArrowDownUp,
} from 'lucide-react';
import clsx from 'clsx';
import { aiLogger } from '../../lib/logger';

// ============ 类型定义 ============

interface SuggestedModel {
  id: string;
  name: string;
  description: string | null;
  context_window: number | null;
  max_tokens: number | null;
  recommended: boolean;
}

interface OfficialProvider {
  id: string;
  name: string;
  icon: string;
  default_base_url: string | null;
  api_type: string;
  suggested_models: SuggestedModel[];
  requires_api_key: boolean;
  docs_url: string | null;
  auth_type: string;
}

interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface CopilotAuthResult {
  success: boolean;
  access_token: string | null;
  user_code: string | null;
  verification_uri: string | null;
  expires_in: number | null;
  error: string | null;
}

interface ConfiguredModel {
  full_id: string;
  id: string;
  name: string;
  api_type: string | null;
  context_window: number | null;
  max_tokens: number | null;
  is_primary: boolean;
  is_fallback: boolean;
}

interface ConfiguredProvider {
  name: string;
  base_url: string;
  api_key_masked: string | null;
  has_api_key: boolean;
  models: ConfiguredModel[];
}

interface AIConfigOverview {
  primary_model: string | null;
  fallback_model: string | null;
  configured_providers: ConfiguredProvider[];
  available_models: string[];
}

// ============ Provider 卡片 ============

interface ProviderCardProps {
  provider: ConfiguredProvider;
  officialProviders: OfficialProvider[];
  onSetPrimary: (modelId: string) => void;
  onSetFallback: (modelId: string) => void;
  onRefresh: () => void;
  onEdit: (provider: ConfiguredProvider) => void;
}

function ProviderCard({ provider, officialProviders, onSetPrimary, onSetFallback, onRefresh, onEdit }: ProviderCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const officialInfo = officialProviders.find(p =>
    provider.name.includes(p.id) || p.id === provider.name
  );
  const isCustomUrl = officialInfo && officialInfo.default_base_url && provider.base_url !== officialInfo.default_base_url;

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke('delete_provider', { providerName: provider.name });
      setShowDeleteConfirm(false);
      onRefresh();
    } catch (e) {
      setDeleteError(t('aiConfig.deleteFailed', { error: String(e) }));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.div layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-surface-card rounded-xl border border-edge overflow-hidden">
      <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-surface-elevated/50 transition-colors" onClick={() => setExpanded(!expanded)}>
        <span className="text-xl">{officialInfo?.icon || '🔌'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-content-primary">{provider.name}</h3>
            {provider.has_api_key && <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">已配置</span>}
            {isCustomUrl && <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">自定义地址</span>}
          </div>
          <p className="text-xs text-content-tertiary truncate">{provider.base_url}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-content-tertiary">{provider.models.length} 模型</span>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }}><ChevronDown size={18} className="text-content-tertiary" /></motion.div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-edge">
            <div className="p-4 space-y-3">
              {provider.api_key_masked && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-content-tertiary">API Key:</span>
                  <code className="px-2 py-0.5 bg-surface-elevated rounded text-content-secondary">{provider.api_key_masked}</code>
                </div>
              )}

              <div className="space-y-2">
                {provider.models.map(model => (
                  <div key={model.full_id} className={clsx('flex items-center justify-between p-3 rounded-lg border transition-all',
                    model.is_primary ? 'bg-claw-500/10 border-claw-500/50'
                      : model.is_fallback ? 'bg-amber-500/10 border-amber-500/50'
                      : 'bg-surface-elevated border-edge'
                  )}>
                    <div className="flex items-center gap-3">
                      <Cpu size={16} className={model.is_primary ? 'text-claw-400' : model.is_fallback ? 'text-amber-400' : 'text-content-tertiary'} />
                      <div>
                        <p className={clsx('text-sm font-medium',
                          model.is_primary ? 'text-content-primary' : model.is_fallback ? 'text-amber-300' : 'text-content-secondary'
                        )}>
                          {model.name}
                          {model.is_primary && <span className="ml-2 text-xs text-claw-400"><Star size={12} className="inline -mt-0.5" /> 主模型</span>}
                          {model.is_fallback && <span className="ml-2 text-xs text-amber-400"><ArrowDownUp size={12} className="inline -mt-0.5" /> 备用模型</span>}
                        </p>
                        <p className="text-xs text-content-tertiary">{model.full_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!model.is_primary && (
                        <button onClick={() => onSetPrimary(model.full_id)} className="text-xs text-content-tertiary hover:text-claw-400 transition-colors">设为主模型</button>
                      )}
                      {!model.is_fallback && (
                        <button onClick={() => onSetFallback(model.full_id)} className="text-xs text-content-tertiary hover:text-amber-400 transition-colors">设为备用</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {showDeleteConfirm && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3">
                  <p className="text-red-400 text-sm">确定要删除 Provider "{provider.name}" 吗？</p>
                  {deleteError && <p className="text-red-300 text-sm bg-red-500/20 p-2 rounded">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button onClick={handleDeleteConfirm} disabled={deleting} className="btn-primary text-sm py-2 px-3 bg-red-500 hover:bg-red-600 flex items-center gap-1">
                      {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}确认删除
                    </button>
                    <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="btn-secondary text-sm py-2 px-3">取消</button>
                  </div>
                </motion.div>
              )}

              {!showDeleteConfirm && (
                <div className="flex justify-end gap-4 pt-2">
                  <button onClick={(e) => { e.stopPropagation(); onEdit(provider); }} className="flex items-center gap-1 text-sm text-claw-400 hover:text-claw-300 transition-colors">
                    <Pencil size={14} /> 编辑
                  </button>
                  <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting} className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300 transition-colors">
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 删除
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============ 主组件 ============

export function AIConfig() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [officialProviders, setOfficialProviders] = useState<OfficialProvider[]>([]);
  const [aiConfig, setAiConfig] = useState<AIConfigOverview | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ConfiguredProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [officials, config] = await Promise.all([
        invoke<OfficialProvider[]>('get_official_providers'),
        invoke<AIConfigOverview>('get_ai_config'),
      ]);
      setOfficialProviders(officials);
      setAiConfig(config);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSetPrimary = async (modelId: string) => {
    try {
      await invoke('set_primary_model', { modelId });
      aiLogger.info(`主模型已设置为: ${modelId}`);
      loadData();
    } catch (e) {
      aiLogger.error('设置主模型失败', e);
      alert('设置失败: ' + e);
    }
  };

  const handleSetFallback = async (modelId: string) => {
    try {
      await invoke('set_fallback_model', { modelId });
      aiLogger.info(`备用模型已设置为: ${modelId}`);
      loadData();
    } catch (e) {
      aiLogger.error('设置备用模型失败', e);
      alert('设置失败: ' + e);
    }
  };

  const handleCloseDialog = () => {
    setShowAddDialog(false);
    setEditingProvider(null);
  };

  const runAITest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<any>('test_ai_connection');
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-claw-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-container pr-2">
      <div className="max-w-4xl space-y-6">
        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 text-red-300">
            <p className="font-medium mb-1">加载失败</p>
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={loadData} className="mt-2 text-sm text-red-300 hover:text-content-primary underline">重试</button>
          </div>
        )}

        <div className="bg-gradient-to-br from-dark-700 to-dark-800 rounded-2xl p-6 border border-edge">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-content-primary flex items-center gap-2">
                <Sparkles size={22} className="text-claw-400" />AI 配置
              </h2>
              <p className="text-sm text-content-tertiary mt-1">管理 OpenClaw 使用的 AI Provider 和模型</p>
            </div>
            <button onClick={() => setShowAddDialog(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />添加 Provider
            </button>
          </div>

          {/* 主模型 + 备用模型 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-surface-elevated/50 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <Star size={20} className="text-claw-400" />
                <span className="text-sm font-medium text-content-secondary">主模型 (Primary)</span>
              </div>
              {aiConfig?.primary_model ? (
                <p className="text-base font-medium text-content-primary">{aiConfig.primary_model}</p>
              ) : (
                <p className="text-base text-content-tertiary">未设置</p>
              )}
            </div>
            <div className="bg-surface-elevated/50 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-2">
                <ArrowDownUp size={20} className="text-amber-400" />
                <span className="text-sm font-medium text-content-secondary">备用模型 (Fallback)</span>
              </div>
              {aiConfig?.fallback_model ? (
                <p className="text-base font-medium text-amber-300">{aiConfig.fallback_model}</p>
              ) : (
                <p className="text-base text-content-tertiary">未设置</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-content-tertiary">
              {aiConfig?.configured_providers.length || 0} 个 Provider，{aiConfig?.available_models.length || 0} 个可用模型
            </div>
            <button onClick={runAITest} disabled={testing || !aiConfig?.primary_model} className="btn-secondary flex items-center gap-2">
              {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              测试连接
            </button>
          </div>

          {testResult && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={clsx('mt-4 p-4 rounded-xl',
              testResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
            )}>
              <div className="flex items-center gap-3">
                {testResult.success ? <CheckCircle size={20} className="text-green-400" /> : <XCircle size={20} className="text-red-400" />}
                <div className="flex-1">
                  <p className={clsx('font-medium', testResult.success ? 'text-green-400' : 'text-red-400')}>
                    {testResult.success ? '连接成功' : '连接失败'}
                  </p>
                  {testResult.latency_ms && <p className="text-xs text-content-secondary">响应时间: {testResult.latency_ms}ms</p>}
                  {testResult.error && <p className="text-xs text-red-300 mt-1">{testResult.error}</p>}
                </div>
                <button onClick={() => setTestResult(null)} className="text-content-tertiary hover:text-content-primary text-sm">关闭</button>
              </div>
            </motion.div>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium text-content-primary flex items-center gap-2">
            <Server size={18} className="text-content-tertiary" />已配置的 Provider
          </h3>
          {aiConfig?.configured_providers.length === 0 ? (
            <div className="bg-surface-card rounded-xl border border-edge p-8 text-center">
              <p className="text-content-secondary mb-4">还没有配置任何 AI Provider</p>
              <button onClick={() => setShowAddDialog(true)} className="btn-primary">添加第一个 Provider</button>
            </div>
          ) : (
            <div className="space-y-3">
              {aiConfig?.configured_providers.map(provider => (
                <ProviderCard
                  key={provider.name}
                  provider={provider}
                  officialProviders={officialProviders}
                  onSetPrimary={handleSetPrimary}
                  onSetFallback={handleSetFallback}
                  onRefresh={loadData}
                  onEdit={(p) => { setEditingProvider(p); setShowAddDialog(true); }}
                />
              ))}
            </div>
          )}
        </div>

        {aiConfig && aiConfig.available_models.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-content-primary flex items-center gap-2">
              <Cpu size={18} className="text-content-tertiary" />可用模型列表
              <span className="text-sm font-normal text-content-tertiary">({aiConfig.available_models.length})</span>
            </h3>
            <div className="bg-surface-card rounded-xl border border-edge p-4">
              <div className="flex flex-wrap gap-2">
                {aiConfig.available_models.map(modelId => (
                  <span key={modelId} className={clsx('inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm',
                    modelId === aiConfig.primary_model ? 'bg-claw-500/20 text-claw-300 border border-claw-500/30'
                      : modelId === aiConfig.fallback_model ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-surface-elevated text-content-secondary'
                  )}>
                    {modelId === aiConfig.primary_model && <Star size={12} />}
                    {modelId === aiConfig.fallback_model && <ArrowDownUp size={12} />}
                    {modelId}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="bg-surface-card/50 rounded-xl p-4 border border-edge">
          <h4 className="text-sm font-medium text-content-secondary mb-2">配置说明</h4>
          <ul className="text-sm text-content-tertiary space-y-1">
            <li>• Provider 配置保存在 <code className="text-claw-400">~/.openclaw/openclaw.json</code></li>
            <li>• <strong className="text-content-secondary">主模型</strong>用于 Agent 的默认推理</li>
            <li>• <strong className="text-content-secondary">备用模型</strong>在主模型不可用时自动降级使用</li>
            <li>• 修改配置后需要重启服务生效</li>
          </ul>
        </div>
      </div>

      {/* 添加/编辑对话框 */}
      {showAddDialog && (
        <ProviderDialog
          officialProviders={officialProviders}
          onClose={handleCloseDialog}
          onSave={loadData}
          editingProvider={editingProvider}
        />
      )}
    </div>
  );
}
