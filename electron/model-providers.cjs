const { app, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const PROVIDER_KINDS = new Set(["openrouter", "openai-compatible"]);

const secretsPath = () => path.join(app.getPath("userData"), "ksnote-secrets.json");

const readSecrets = async () => {
  try {
    return JSON.parse(await fs.readFile(secretsPath(), "utf8"));
  } catch {
    return {};
  }
};

const writeSecrets = async (secrets) => {
  await fs.writeFile(secretsPath(), JSON.stringify(secrets), "utf8");
};

const defaultBaseUrl = (kind) =>
  kind === "openrouter" ? "https://openrouter.ai/api/v1" : "";

const normalizeProvider = (provider = {}) => {
  const kind = PROVIDER_KINDS.has(provider.kind) ? provider.kind : "openrouter";
  return {
    id: String(provider.id || ""),
    kind,
    name: String(provider.name || (kind === "openrouter" ? "OpenRouter" : "OpenAI 호환")).slice(0, 80),
    enabled: provider.enabled !== false,
    baseUrl: String(provider.baseUrl || defaultBaseUrl(kind)).replace(/\/+$/, ""),
    models: Array.isArray(provider.models)
      ? provider.models
          .filter((model) => model && model.id)
          .map((model) => ({
            id: String(model.id),
            label: String(model.label || model.id),
            enabled: model.enabled !== false,
          }))
      : [],
    fetchedAt: Number(provider.fetchedAt) || 0,
  };
};

const saveApiKey = async (providerId, apiKey) => {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("이 기기에서 안전한 키 저장을 사용할 수 없습니다.");
  const secrets = await readSecrets();
  if (apiKey) secrets[providerId] = safeStorage.encryptString(String(apiKey)).toString("base64");
  else delete secrets[providerId];
  await writeSecrets(secrets);
};

const readApiKey = async (providerId) => {
  const secrets = await readSecrets();
  const stored = secrets[providerId];
  if (!stored) return "";
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return "";
  }
};

const fetchJson = async (url, apiKey, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    let json = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {}
    return { ok: response.ok, status: response.status, json, body };
  } finally {
    clearTimeout(timer);
  }
};

const fetchProviderModels = async (provider) => {
  const normalized = normalizeProvider(provider);
  if (!normalized.baseUrl) throw new Error("Base URL을 입력해 주세요.");
  const apiKey = await readApiKey(normalized.id);
  const result = await fetchJson(`${normalized.baseUrl}/models`, apiKey);
  if (!result.ok || !result.json)
    throw new Error(
      result.json?.error?.message ||
        `모델 목록을 가져오지 못했습니다 (HTTP ${result.status}).`,
    );
  const items = Array.isArray(result.json.data) ? result.json.data : [];
  const previous = new Map(normalized.models.map((model) => [model.id, model]));
  return items.map((item) => {
    const id = String(item.id || item.name || "");
    const kept = previous.get(id);
    return {
      id,
      label: String(item.name || id),
      enabled: kept ? kept.enabled : true,
    };
  }).filter((model) => model.id);
};

module.exports = {
  PROVIDER_KINDS,
  defaultBaseUrl,
  normalizeProvider,
  saveApiKey,
  readApiKey,
  fetchProviderModels,
  fetchJson,
};
