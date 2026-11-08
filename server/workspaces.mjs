import fs from 'node:fs';
import path from 'node:path';
import { accountIdFor, readAccountStore, writeAccountStore } from './account-store.mjs';

const WORKSPACE_ENTRIES = [
  'state.json', 'lessons.json', 'before-reset-state.json', 'before-reset-lessons.json',
  'model-service.json', 'documents', 'lesson-visual', 'knowledge',
];

export function workspacePath(dataDir, accountOrId) {
  const id = typeof accountOrId === 'string' ? accountOrId : accountIdFor(accountOrId);
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('账户工作区标识无效。');
  return path.join(dataDir, 'users', id);
}

/** 旧版本的数据只迁移到明确的账户目录；遇到同名冲突时停止，绝不覆盖。 */
export function migrateLegacyWorkspace(dataDir, account) {
  const store = readAccountStore(dataDir);
  const legacyEntries = WORKSPACE_ENTRIES.filter(name => fs.existsSync(path.join(dataDir, name)));
  const owner = account || (store.accounts.length === 1 ? store.accounts[0] : null);
  if (legacyEntries.length && !owner && store.accounts.length > 0) {
    throw new Error('根目录存在尚未归属的学习数据，请先备份 data 目录并恢复为单账户后再启动。');
  }
  if (!owner) return null;
  if (legacyEntries.length) {
    const target = workspacePath(dataDir, owner);
    fs.mkdirSync(target, { recursive: true });
    for (const name of legacyEntries) {
      const source = path.join(dataDir, name);
      const destination = path.join(target, name);
      if (fs.existsSync(destination)) throw new Error(`旧数据迁移遇到同名文件：${name}。请备份 data 目录后手动合并，现有文件未被覆盖。`);
      fs.renameSync(source, destination);
    }
  }
  if (store.legacy) writeAccountStore(dataDir, store.accounts);
  return owner ? workspacePath(dataDir, owner) : null;
}

export function createWorkspaceManager({ dataDir, createWorkspace }) {
  if (typeof createWorkspace !== 'function') throw new Error('缺少账户工作区创建器。');
  const workspaces = new Map();
  const get = account => {
    const id = accountIdFor(account);
    if (!workspaces.has(id)) {
      const directory = workspacePath(dataDir, id);
      workspaces.set(id, createWorkspace(directory, account));
    }
    return workspaces.get(id);
  };
  return {
    get,
    onAccountCreated(account) {
      // 未登录时代产生的根目录数据只归属于第一个新账户。
      if (readAccountStore(dataDir).accounts.length === 1) migrateLegacyWorkspace(dataDir, account);
      get(account);
    },
    close() {
      for (const workspace of workspaces.values()) workspace.emit('shifen:close');
    },
  };
}
