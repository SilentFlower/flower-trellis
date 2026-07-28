import { CredentialStore, credentialAccount, validateCredential } from "./credential-store.js";

/**
 * 只在当前进程存活的 OAuth 凭据存储。
 */
export class MemoryCredentialStore extends CredentialStore {
  /** 创建空内存凭据存储。 */
  constructor() {
    super();
    this.entries = new Map();
  }

  /**
   * 读取来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @returns {Promise<object|null>} 凭据或空值
   */
  async get(source) {
    const value = this.entries.get(credentialAccount(source));
    return value ? validateCredential(structuredClone(value), source) : null;
  }

  /**
   * 保存来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @param {object} credential 凭据
   * @returns {Promise<void>} 完成信号
   */
  async set(source, credential) {
    this.entries.set(credentialAccount(source), validateCredential(credential, source));
  }

  /**
   * 删除来源凭据。
   *
   * @param {{id:string,baseUrl:string}} source 来源
   * @returns {Promise<void>} 完成信号
   */
  async delete(source) {
    this.entries.delete(credentialAccount(source));
  }
}
