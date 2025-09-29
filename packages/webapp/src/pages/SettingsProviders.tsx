import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

type Provider = {
  name: string;
  baseUrl: string;
  models: string[];
  apiKeyEnvVar?: string;
  apiType?: string;
};

type ProvidersConfig = {
  providers: Record<string, Provider>;
  default?: string;
};

type TestResult = {
  connected: boolean;
  latency?: number;
  model?: string;
  message: string;
};

function ProviderConfigForm({
  providerId,
  provider,
  onTest,
}: {
  providerId: string;
  provider: Provider;
  onTest?: (providerId: string, model: string) => void;
}) {
  const [selectedModel, setSelectedModel] = useState(provider.models[0] || '');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          model: selectedModel,
        }),
      });

      const result = await response.json();
      if (result.ok) {
        setTestResult(result.result);
      } else {
        setTestResult({
          connected: false,
          message: result.message || '测试失败',
        });
      }
    } catch (err) {
      setTestResult({ connected: false, message: '网络错误' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      style={{
        border: '1px solid #e1e4e8',
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>{provider.name}</h3>

      <div style={{ marginBottom: 12 }}>
        <label
          style={{
            display: 'block',
            marginBottom: 4,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Base URL
        </label>
        <input
          type="text"
          value={provider.baseUrl}
          disabled
          style={{
            width: '100%',
            padding: 8,
            border: '1px solid #d1d5da',
            borderRadius: 4,
            backgroundColor: '#f6f8fa',
            color: '#586069',
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label
          style={{
            display: 'block',
            marginBottom: 4,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          凭证来源
        </label>
        <input
          type="text"
          value={
            provider.apiKeyEnvVar
              ? `环境变量 ${provider.apiKeyEnvVar}`
              : '未指定（按 apiType 默认）'
          }
          disabled
          style={{
            width: '100%',
            padding: 8,
            border: '1px solid #d1d5da',
            borderRadius: 4,
            backgroundColor: '#f6f8fa',
            color: '#586069',
          }}
        />
        {provider.apiType && (
          <div style={{ fontSize: 12, color: '#586069', marginTop: 4 }}>
            API 类型：{provider.apiType}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label
          style={{
            display: 'block',
            marginBottom: 4,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          测试模型
        </label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          style={{
            width: '100%',
            padding: 8,
            border: '1px solid #d1d5da',
            borderRadius: 4,
          }}
        >
          {provider.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleTest}
          disabled={testing}
          style={{
            padding: '8px 16px',
            backgroundColor: testing ? '#f6f8fa' : '#0366d6',
            color: testing ? '#586069' : 'white',
            border: 'none',
            borderRadius: 4,
            cursor: testing ? 'not-allowed' : 'pointer',
          }}
        >
          {testing ? '测试中...' : '测试连接'}
        </button>

        {testResult && (
          <div
            style={{
              fontSize: 14,
              color: testResult.connected ? '#28a745' : '#d73a49',
            }}
          >
            {testResult.connected ? '✓' : '✗'} {testResult.message}
            {testResult.latency && ` (${testResult.latency}ms)`}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SettingsProviders() {
  const [config, setConfig] = useState<ProvidersConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBuiltIn, setIsBuiltIn] = useState(false);

  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) {
          setConfig(res.config);
          setIsBuiltIn(res.isBuiltIn || false);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleTest = (providerId: string, apiKey: string, baseUrl: string, model: string) => {
    // Test function is handled within ProviderConfigForm
  };

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Provider 设置</h2>
        <div>加载中...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 800 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: '#0366d6', textDecoration: 'none' }}>
          ← 返回首页
        </Link>
      </div>

      <h2 style={{ marginBottom: 16 }}>Provider 设置</h2>

      {isBuiltIn && (
        <div
          style={{
            backgroundColor: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: 4,
            padding: 12,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          <strong>注意：</strong> 正在使用内置 Provider 模板。可在项目根目录配置{' '}
          <code>.minds/provider.yaml</code> 覆盖默认设置（推荐通过环境变量提供密钥）。
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <p style={{ color: '#586069', marginBottom: 16 }}>
          配置和测试 AI Provider 连接。API Keys 需要在配置文件中设置，此处仅用于连通性测试。
        </p>
      </div>

      {config &&
        Object.entries(config.providers).map(([providerId, provider]) => (
          <ProviderConfigForm
            key={providerId}
            providerId={providerId}
            provider={provider}
            onTest={handleTest}
          />
        ))}

      {config && config.default && (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            backgroundColor: '#f6f8fa',
            borderRadius: 6,
          }}
        >
          <h4 style={{ marginTop: 0, marginBottom: 8 }}>当前默认 Provider</h4>
          <div style={{ fontSize: 14 }}>
            {config.providers[config.default]?.name || config.default}
          </div>
        </div>
      )}
    </div>
  );
}
