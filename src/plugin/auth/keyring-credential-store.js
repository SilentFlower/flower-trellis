import { CredentialStore, credentialAccount, validateCredential } from "./credential-store.js";
import { MemoryCredentialStore } from "./memory-credential-store.js";
import { PLUGIN_RUNTIME_ERROR_CODES, PluginRuntimeError } from "../runtime-errors.js";

/** Keyring service 名称。 */
export const KEYRING_SERVICE = "flower-trellis";

/**
 * `@napi-rs/keyring` 凭据存储适配器。
 */
export class KeyringCredentialStore extends CredentialStore {
  /**
   * 创建 Keyring 适配器。
   *
   * @param {{Entry:new(service:string,account:string)=>object}} keyring Keyring 模块
   */
  constructor(keyring) {
    super();
    this.Entry = keyring.Entry;
  }

  /**
   * 读取来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @returns {Promise<object|null>} 凭据或空值
   */
  async get(source) {
    const entry = new this.Entry(KEYRING_SERVICE, credentialAccount(source));
    const raw = await entry.getPassword();
    if (!raw) return null;
    try {
      return validateCredential(JSON.parse(raw), source);
    } catch (error) {
      if (error instanceof PluginRuntimeError) throw error;
      throw new PluginRuntimeError(`Keyring 凭据 JSON 损坏:${source.id}`, {
        code: PLUGIN_RUNTIME_ERROR_CODES.AUTH_SCOPE_INVALID,
        path: source.id,
        cause: error,
      });
    }
  }

  /**
   * 保存来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @param {object} credential 凭据
   * @returns {Promise<void>} 完成信号
   */
  async set(source, credential) {
    const entry = new this.Entry(KEYRING_SERVICE, credentialAccount(source));
    await entry.setPassword(JSON.stringify(validateCredential(credential, source)));
  }

  /**
   * 删除来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @returns {Promise<void>} 完成信号
   */
  async delete(source) {
    const entry = new this.Entry(KEYRING_SERVICE, credentialAccount(source));
    try {
      await entry.deletePassword();
    } catch (error) {
      if (!String(error?.message || error).toLowerCase().includes("not found")) throw error;
    }
  }
}

/**
 * Keyring 后端运行时失败时切换到内存的凭据存储。
 */
export class FallbackCredentialStore extends CredentialStore {
  /**
   * 创建可降级存储。
   *
   * @param {CredentialStore} primary 系统 Keyring
   * @param {MemoryCredentialStore} fallback 内存存储
   */
  constructor(primary, fallback) {
    super();
    this.primary = primary;
    this.fallback = fallback;
    this.active = primary;
    this.persistent = true;
  }

  /** @param {object} source @returns {Promise<object|null>} */
  async get(source) {
    return this.#run("get", source);
  }

  /** @param {object} source @param {object} credential @returns {Promise<void>} */
  async set(source, credential) {
    await this.#run("set", source, credential);
  }

  /** @param {object} source @returns {Promise<void>} */
  async delete(source) {
    await this.#run("delete", source);
  }

  /** @param {"get"|"set"|"delete"} method @param {object} source @param {object} [credential] @returns {Promise<any>} */
  async #run(method, source, credential) {
    try {
      return await this.active[method](source, credential);
    } catch (error) {
      if (error instanceof PluginRuntimeError || this.active === this.fallback) throw error;
      this.active = this.fallback;
      this.persistent = false;
      return this.active[method](source, credential);
    }
  }
}

/**
 * 创建可用的安全凭据存储；系统 Keyring 不可用时仅退回进程内存。
 *
 * @param {{loadKeyring?:()=>Promise<object>,memoryStore?:MemoryCredentialStore}} [options] 测试注入
 * @returns {Promise<{store:CredentialStore,persistent:boolean}>} 存储与持久性标记
 */
export async function createCredentialStore(options = {}) {
  const memoryStore = options.memoryStore || new MemoryCredentialStore();
  try {
    const keyring = await (options.loadKeyring || (() => import("@napi-rs/keyring")))();
    if (typeof keyring.Entry !== "function") throw new TypeError("Keyring Entry 不可用");
    const store = new FallbackCredentialStore(new KeyringCredentialStore(keyring), memoryStore);
    const bundle = { store };
    Object.defineProperty(bundle, "persistent", { enumerable: true, get: () => store.persistent });
    return bundle;
  } catch {
    return { store: memoryStore, persistent: false };
  }
}
