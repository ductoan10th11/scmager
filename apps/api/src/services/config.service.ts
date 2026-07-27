import ConfigModel from '../models/config.model';
import type { AuthUser } from '../types/auth';
import { badRequest, forbidden } from '../utils/http-error';

export const EXTENSION_VERSION_CONFIG_KEY = 'extension.currentVersion';
export const DEFAULT_EXTENSION_VERSION = '1.0.0';

const CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const SEMVER_IDENTIFIER = '(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER_PATTERN = new RegExp(`^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?$`);

const requireAdmin = (actor: AuthUser) => {
  if (actor.role?.code !== 'ADMIN') throw forbidden('Only administrators can manage system configuration.');
};

const normalizeKey = (value: unknown) => {
  if (typeof value !== 'string' || !CONFIG_KEY_PATTERN.test(value) || value.length > 120) {
    throw badRequest('Configuration key is invalid.');
  }
  return value;
};

const isJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > 8 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return false;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.length <= 200 && value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 100 && entries.every(([key, item]) => key.length <= 120 && isJsonValue(item, depth + 1));
};

export const isValidExtensionVersion = (value: unknown): value is string => typeof value === 'string' && SEMVER_PATTERN.test(value);

const persistConfig = async (key: string, value: unknown) => {
  const config = await ConfigModel.findOneAndUpdate(
    { key },
    { $set: { value } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return { data: { key: String(config.key), value: config.value } };
};

export const getConfig = async (actor: AuthUser, keyInput: unknown) => {
  requireAdmin(actor);
  const key = normalizeKey(keyInput);
  const config = await ConfigModel.findOne({ key }).lean();
  return { data: { key, value: config?.value ?? null } };
};

export const setConfig = async (actor: AuthUser, keyInput: unknown, payload: unknown) => {
  requireAdmin(actor);
  const key = normalizeKey(keyInput);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.prototype.hasOwnProperty.call(payload, 'value')) {
    throw badRequest('Configuration value is required.');
  }
  const value = (payload as Record<string, unknown>).value;
  if (!isJsonValue(value)) throw badRequest('Configuration value must be valid JSON data.');
  if (key === EXTENSION_VERSION_CONFIG_KEY) return setExtensionVersion(actor, { version: value });
  return persistConfig(key, value);
};

export const getExtensionVersion = async () => {
  const config = await ConfigModel.findOne({ key: EXTENSION_VERSION_CONFIG_KEY }).lean();
  const version = isValidExtensionVersion(config?.value) ? config.value : DEFAULT_EXTENSION_VERSION;
  return { data: { version } };
};

export const getExtensionVersionForAdmin = async (actor: AuthUser) => {
  requireAdmin(actor);
  return getExtensionVersion();
};

export const setExtensionVersion = async (actor: AuthUser, payload: unknown) => {
  requireAdmin(actor);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('Version is required.');
  const version = (payload as Record<string, unknown>).version;
  if (!isValidExtensionVersion(version) || version.length > 64) throw badRequest('Version must be a semantic version such as 1.2.3.');
  return persistConfig(EXTENSION_VERSION_CONFIG_KEY, version);
};
