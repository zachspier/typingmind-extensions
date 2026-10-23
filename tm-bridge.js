(function () {
  if (window.__TM_INST_BRIDGE_LOADED__) return;
  window.__TM_INST_BRIDGE_LOADED__ = true;

  const state = {
    pendingGlobal: undefined,
    pendingEnabledPluginsMap: undefined,
    pendingFolders: undefined,
    pendingCharacters: undefined,
    pendingCharVersions: {},
    reloadTimer: null,
  };

  // TypingMind's static UUIDv5 namespace for local MCP server IDs
  const MCP_UUID_NAMESPACE_BYTES = new Uint8Array([
    0xc0, 0x6b, 0xeb, 0xc2, 0x23, 0x4b, 0x49, 0x87,
    0x9a, 0xbc, 0x91, 0x4d, 0x9a, 0x04, 0x2c, 0xbb,
  ]);

  const BUILTIN_TOOLS = [
    {
      id: 'deae611f-9722-5039-b7f1-76271e299c03',
      uuid: 'deae611f-9722-5039-b7f1-76271e299c03',
      title: 'Web Browser',
      type: 'builtin',
      emoji: null,
      iconURL: 'https://www.typingmind.com/assets/provider-tools/web-search.svg',
    },
    {
      id: 'toolbox_run_js',
      uuid: 'toolbox_run_js',
      title: 'Run JavaScript (Toolbox)',
      type: 'builtin',
    },
    {
      id: 'toolbox_run_python',
      uuid: 'toolbox_run_python',
      title: 'Run Python (Toolbox)',
      type: 'builtin',
    },
  ];

  const AVATAR_PALETTE = [
    '#3B82F6', '#6366F1', '#8B5CF6', '#0EA5E9', '#10B981',
    '#14B8A6', '#06B6D4', '#F59E0B', '#EA580C', '#EC4899',
    '#F43F5E', '#EF4444', '#84CC16', '#64748B',
  ];

  const AGENT_AVATAR_PRESETS = {
    'AI/LLM Tooling Agent':      { color: '#3B82F6', shape: 'square' },
    'Coding Agent':              { color: '#6366F1', shape: 'square' },
    'TypingMind Mods Agent':     { color: '#8B5CF6', shape: 'square' },
    'Agents Agent':              { color: '#0EA5E9', shape: 'square' },
    'Making Agent':              { color: '#0EA5E9', shape: 'square' },
    'Instructions Manager':      { color: '#F59E0B', shape: 'square' },
    'Spec Manager':              { color: '#EA580C', shape: 'square' },
    'Chemistry Agent':           { color: '#10B981', shape: 'dot' },
    'Compounding Agent':         { color: '#14B8A6', shape: 'dot' },
    'Formulation Agent':         { color: '#06B6D4', shape: 'dot' },
    'Counseling Research Agent': { color: '#EC4899', shape: 'dot' },
    'Mentee Information':        { color: '#F43F5E', shape: 'dot' },
    'Workouts Agent':            { color: '#EF4444', shape: 'dot' },
    'Tea Agent':                 { color: '#84CC16', shape: 'dot' },
    'Inbox Agent':               { color: '#64748B', shape: 'dot' },
  };

  async function uuidv5MCP(serverName) {
    const nameBytes = new TextEncoder().encode(String(serverName));
    const combined = new Uint8Array(MCP_UUID_NAMESPACE_BYTES.length + nameBytes.length);
    combined.set(MCP_UUID_NAMESPACE_BYTES, 0);
    combined.set(nameBytes, MCP_UUID_NAMESPACE_BYTES.length);
    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);
    const bytes = new Uint8Array(hashBuffer.slice(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function makeAvatarSvgDataUri({ color = '#3B82F6', shape = 'dot', label = '' }) {
    const geom = shape === 'square'
      ? `<rect x="6" y="6" width="52" height="52" rx="12" fill="${color}"/>`
      : `<circle cx="32" cy="32" r="26" fill="${color}"/>`;
    const textEl = label
      ? `<text x="32" y="32" dy=".35em" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="700">${label}</text>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${geom}${textEl}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function resolveAgentAvatar(title, { avatarURL, avatarColor, avatarShape, avatarLabel } = {}) {
    const preset = AGENT_AVATAR_PRESETS[String(title || '').trim()];
    const h = hashString(String(title || 'agent'));
    const color = avatarColor || (preset && preset.color) || AVATAR_PALETTE[h % AVATAR_PALETTE.length];
    const shape = avatarShape || (preset && preset.shape) || (h % 2 === 0 ? 'square' : 'dot');
    const url = avatarURL || makeAvatarSvgDataUri({ color, shape, label: avatarLabel || '' });
    return { avatarURL: url, color, shape };
  }

  function openKeyvalDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('keyval-store');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openKeyvalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readonly');
      const req = tx.objectStore('keyval').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, val) {
    const db = await openKeyvalDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite');
      const req = tx.objectStore('keyval').put(val, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  function getEnabledPluginsMap() {
    if (state.pendingEnabledPluginsMap !== undefined) {
      return JSON.parse(JSON.stringify(state.pendingEnabledPluginsMap));
    }
    try {
      return JSON.parse(localStorage.getItem('TM_useEnabledPluginsMap') || '{}');
    } catch {
      return {};
    }
  }

  function saveEnabledPluginsMap(map) {
    state.pendingEnabledPluginsMap = JSON.parse(JSON.stringify(map));
    localStorage.setItem('TM_useEnabledPluginsMap', JSON.stringify(map));
  }

  async function getPluginCatalog() {
    const enabledMap = getEnabledPluginsMap();
    const catalog = [];
    const seenIds = new Set();

    const addEntry = (entry) => {
      if (!entry || !entry.id || seenIds.has(entry.id)) return;
      seenIds.add(entry.id);
      if (entry.uuid) seenIds.add(entry.uuid);
      const isEnabled = Boolean(
        enabledMap[entry.id]?.enabled || (entry.uuid && enabledMap[entry.uuid]?.enabled)
      );
      catalog.push({
        id: entry.id,
        uuid: entry.uuid || entry.id,
        title: entry.title || entry.id,
        type: entry.type || 'plugin',
        globallyEnabled: isEnabled,
        ...(entry.emoji !== undefined ? { emoji: entry.emoji } : {}),
        ...(entry.iconURL ? { iconURL: entry.iconURL } : {}),
      });
    };

    // 1. Local MCP servers from TM_useSavedMCPServersJSON
    try {
      const rawMCP = localStorage.getItem('TM_useSavedMCPServersJSON');
      let parsedMCP = rawMCP ? JSON.parse(rawMCP) : {};
      if (typeof parsedMCP === 'string') parsedMCP = JSON.parse(parsedMCP);
      const mcpServers = parsedMCP?.mcpServers || {};
      for (const serverName of Object.keys(mcpServers).sort()) {
        const uuid = await uuidv5MCP(serverName);
        addEntry({
          id: uuid,
          uuid: uuid,
          title: serverName,
          type: 'mcp_local',
        });
      }
    } catch {}

    // 2. Remote MCP connections from IndexedDB TM_useUserMCPConnections
    try {
      const mcpConns = (await idbGet('TM_useUserMCPConnections')) || [];
      for (const conn of mcpConns) {
        if (!conn || !conn.id) continue;
        addEntry({
          id: conn.id,
          uuid: conn.id,
          title: conn.name || conn.id,
          type: 'mcp_remote',
        });
      }
    } catch {}

    // 3. Installed plugins from IndexedDB TM_useInstalledPlugins
    try {
      const installed = (await idbGet('TM_useInstalledPlugins')) || [];
      for (const p of installed) {
        if (!p || p.deletedAt || !p.id) continue;
        addEntry({
          id: p.id,
          uuid: p.uuid || p.id,
          title: p.title || p.id,
          type: 'plugin',
          emoji: p.emoji,
          iconURL: p.iconURL,
        });
      }
    } catch {}

    // 4. Built-in tools
    for (const b of BUILTIN_TOOLS) {
      addEntry(b);
    }

    return catalog;
  }

  function resolveCatalogEntries(identifiers, catalog) {
    if (!Array.isArray(identifiers)) {
      throw new Error('Plugin/MCP list must be an array of server/plugin titles or IDs');
    }
    const norm = (s) => String(s || '').trim().toLowerCase();
    const resolved = [];
    for (const raw of identifiers) {
      const target = norm(raw);
      if (!target) continue;
      const match = catalog.find(
        (c) => norm(c.title) === target || norm(c.id) === target || norm(c.uuid) === target
      );
      if (!match) {
        const available = catalog.map((c) => `${c.title} (${c.type})`).join(', ');
        throw new Error(`Unknown plugin or MCP server "${raw}". Available: ${available}`);
      }
      resolved.push(match);
    }
    return resolved;
  }

  function buildAssignedPluginsMap(entries) {
    const map = {};
    for (const e of entries) {
      const key = e.uuid || e.id;
      const item = {
        id: e.id,
        uuid: e.uuid || e.id,
        title: e.title,
      };
      if (e.iconURL) {
        item.emoji = e.emoji ?? null;
        item.iconURL = e.iconURL;
      }
      map[key] = item;
    }
    return map;
  }

  function formatAgentAssignedPlugins(assignedPluginsObj, catalog) {
    const byIdOrUuid = {};
    for (const c of catalog || []) {
      byIdOrUuid[c.id] = c;
      if (c.uuid) byIdOrUuid[c.uuid] = c;
    }
    return Object.values(assignedPluginsObj || {})
      .filter((p) => p && (p.id || p.uuid))
      .map((p) => {
        const cat = byIdOrUuid[p.uuid] || byIdOrUuid[p.id];
        return {
          id: p.id || cat?.id,
          uuid: p.uuid || cat?.uuid || p.id,
          title: p.title || cat?.title || p.id,
          type: cat?.type || 'unknown',
        };
      });
  }

  function getFolders() {
    if (state.pendingFolders !== undefined) {
      return JSON.parse(JSON.stringify(state.pendingFolders));
    }
    try {
      return JSON.parse(localStorage.getItem('TM_useFolderList') || '[]');
    } catch {
      return [];
    }
  }

  function saveFolders(folders) {
    state.pendingFolders = JSON.parse(JSON.stringify(folders));
    localStorage.setItem('TM_useFolderList', JSON.stringify(folders));
  }

  function getGlobalMessage() {
    if (state.pendingGlobal !== undefined) return state.pendingGlobal;
    const raw = localStorage.getItem('TM_useDefaultSystemMessage');
    if (raw === null) return '';
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : String(raw);
    } catch {
      return raw;
    }
  }

  function saveGlobalMessage(text, nowISO) {
    state.pendingGlobal = text;
    const raw = localStorage.getItem('TM_useDefaultSystemMessage');
    let useJson = false;
    if (raw !== null) {
      try {
        JSON.parse(raw);
        useJson = true;
      } catch {
        useJson = false;
      }
    }
    localStorage.setItem('TM_useDefaultSystemMessage', useJson ? JSON.stringify(text) : text);
    try {
      const hist = JSON.parse(localStorage.getItem('TM_useStateUpdateHistory') || '{}');
      hist.defaultSystemMessage = nowISO;
      localStorage.setItem('TM_useStateUpdateHistory', JSON.stringify(hist));
    } catch {}
  }

  async function getCharacters() {
    if (state.pendingCharacters !== undefined) {
      return JSON.parse(JSON.stringify(state.pendingCharacters));
    }
    const chars = await idbGet('TM_useUserCharacters');
    state.pendingCharacters = Array.isArray(chars) ? JSON.parse(JSON.stringify(chars)) : [];
    return JSON.parse(JSON.stringify(state.pendingCharacters));
  }

  async function saveCharacters(chars) {
    state.pendingCharacters = JSON.parse(JSON.stringify(chars));
    await idbSet('TM_useUserCharacters', chars);
  }

  async function appendCharacterVersion(agent) {
    const key = `CHARACTER_VERSIONS_${agent.id}`;
    const existing = (await idbGet(key)) || [];
    const entry = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      data: JSON.parse(JSON.stringify({ ...agent, syncedAt: null })),
    };
    const updated = [entry, ...(Array.isArray(existing) ? existing : [])].slice(0, 20);
    state.pendingCharVersions[key] = updated;
    await idbSet(key, updated);
  }

  async function flushPendingWrites() {
    const nowISO = new Date().toISOString();
    if (state.pendingGlobal !== undefined) {
      saveGlobalMessage(state.pendingGlobal, nowISO);
    }
    if (state.pendingEnabledPluginsMap !== undefined) {
      localStorage.setItem('TM_useEnabledPluginsMap', JSON.stringify(state.pendingEnabledPluginsMap));
    }
    if (state.pendingFolders !== undefined) {
      localStorage.setItem('TM_useFolderList', JSON.stringify(state.pendingFolders));
    }
    if (state.pendingCharacters !== undefined) {
      await idbSet('TM_useUserCharacters', state.pendingCharacters);
    }
    for (const [k, v] of Object.entries(state.pendingCharVersions)) {
      await idbSet(k, v);
    }
  }

  function isAIStreaming() {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some((b) => {
      const text = (b.textContent || '').trim().toLowerCase();
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('stop generating') || text === 'stop' || label.includes('stop generating');
    });
  }

  function scheduleAutoReload() {
    if (state.reloadTimer) clearTimeout(state.reloadTimer);
    let attempts = 0;
    const check = async () => {
      attempts++;
      if (isAIStreaming() && attempts < 60) {
        state.reloadTimer = setTimeout(check, 1000);
        return;
      }
      state.reloadTimer = setTimeout(async () => {
        if (isAIStreaming() && attempts < 60) {
          check();
          return;
        }
        await flushPendingWrites();
        location.reload();
      }, 1800);
    };
    state.reloadTimer = setTimeout(check, 1200);
  }

  function buildFolderIndex(folders) {
    const byId = {};
    for (const f of folders) {
      byId[f.id] = f;
    }
    const GROUPING_TITLES = new Set(['systems', 'laboratory', 'hobbies', 'counseling']);
    function isGroup(f) {
      if (!f || f.deletedAt || f.parentID) return false;
      if (f.settings?.assignedAgentID || (f.settings?.systemMessage || '').trim()) return false;
      const normTitle = String(f.title || '').trim().toLowerCase();
      if (GROUPING_TITLES.has(normTitle)) return true;
      const children = folders.filter((c) => !c.deletedAt && c.parentID === f.id);
      return children.some(
        (c) => c.settings?.assignedAgentID || folders.some((gc) => !gc.deletedAt && gc.parentID === c.id)
      );
    }
    function getEffectiveParent(f) {
      if (!f || !f.parentID) return null;
      const p = byId[f.parentID];
      if (!p || p.deletedAt || isGroup(p)) return null;
      return p;
    }
    function getEffectiveDepth(f) {
      let d = 0;
      let curr = getEffectiveParent(f);
      let guard = 0;
      while (curr && guard < 10) {
        d++;
        curr = getEffectiveParent(curr);
        guard++;
      }
      return d;
    }
    function getPath(f) {
      const parts = [f.title.trim()];
      let curr = getEffectiveParent(f);
      let guard = 0;
      while (curr && guard < 10) {
        parts.unshift(curr.title.trim());
        curr = getEffectiveParent(curr);
        guard++;
      }
      return parts.join(' / ');
    }
    function isGroupingRef({ id, title } = {}) {
      if (id && byId[id] && isGroup(byId[id])) return true;
      if (title) {
        const t = String(title).trim().toLowerCase();
        if (GROUPING_TITLES.has(t)) return true;
        if (folders.some((f) => !f.deletedAt && isGroup(f) && String(f.title || '').trim().toLowerCase() === t)) return true;
      }
      return false;
    }
    return { byId, isGroup, isGroupingRef, getEffectiveParent, getEffectiveDepth, getPath };
  }

  function findFolder(folders, { id, title, parentTitle }) {
    const { byId, isGroup, isGroupingRef, getEffectiveParent, getPath } = buildFolderIndex(folders);
    if (id && byId[id] && !isGroup(byId[id])) return byId[id];
    if (!title) return null;
    const norm = (s) => String(s || '').trim().toLowerCase();
    const targetTitle = norm(title);
    const targetParent = parentTitle && !isGroupingRef({ title: parentTitle }) ? norm(parentTitle) : null;

    const matches = folders.filter((f) => {
      if (f.deletedAt || isGroup(f)) return false;
      if (norm(f.title) !== targetTitle && norm(getPath(f)) !== targetTitle) return false;
      if (targetParent) {
        const p = getEffectiveParent(f);
        if (!p || norm(p.title) !== targetParent) return false;
      }
      return true;
    });
    return matches[0] || null;
  }

  function findAgent(chars, { id, title }) {
    if (id) {
      const exact = chars.find((c) => c.id === id);
      if (exact) return exact;
    }
    if (!title) return null;
    const norm = (s) => String(s || '').trim().toLowerCase();
    const target = norm(title);
    return chars.find((c) => !c.deletedAt && norm(c.title) === target) || null;
  }

  async function handleRequest(action, payload = {}) {
    const nowISO = new Date().toISOString();

    if (action === 'list_targets') {
      const globalMsg = getGlobalMessage();
      const folders = getFolders().filter((f) => !f.deletedAt);
      const chars = (await getCharacters()).filter((c) => !c.deletedAt);
      const catalog = await getPluginCatalog();
      const { isGroup, getEffectiveParent, getEffectiveDepth, getPath } = buildFolderIndex(folders);
      const charById = Object.fromEntries(chars.map((c) => [c.id, c]));
      const hist = JSON.parse(localStorage.getItem('TM_useStateUpdateHistory') || '{}');

      return {
        global: {
          length: globalMsg.length,
          preview: globalMsg.slice(0, 160),
          updatedAt: hist.defaultSystemMessage || null,
          enabledPlugins: catalog.filter((p) => p.globallyEnabled).map((p) => p.title),
        },
        availablePlugins: catalog.map((p) => ({
          title: p.title,
          id: p.id,
          type: p.type,
          globallyEnabled: p.globallyEnabled,
        })),
        agents: chars.map((c) => {
          const assigned = formatAgentAssignedPlugins(c.assignedPlugins, catalog);
          return {
            id: c.id,
            title: c.title,
            color: c.color || null,
            avatarURL: c.avatarURL || null,
            categories: c.categories || [],
            isEnforceAssignedPlugins: Boolean(c.isEnforceAssignedPlugins),
            assignedPlugins: assigned.map((p) => p.title),
            instructionLength: (c.instruction || '').length,
            instructionPreview: (c.instruction || '').slice(0, 140),
            syncedAt: c.syncedAt || null,
          };
        }),
        folders: folders
          .filter((f) => !isGroup(f))
          .map((f) => {
            const sysMsg = f.settings?.systemMessage || '';
            const agentID = f.settings?.assignedAgentID || null;
            const effParent = getEffectiveParent(f);
            return {
              id: f.id,
              title: f.title,
              path: getPath(f),
              depth: getEffectiveDepth(f),
              parentID: effParent ? effParent.id : null,
              parentTitle: effParent ? effParent.title : null,
              assignedAgentID: agentID,
              assignedAgentTitle: agentID ? charById[agentID]?.title || null : null,
              instructionLength: sysMsg.length,
              instructionPreview: sysMsg.slice(0, 140),
              updatedAt: f.updatedAt || null,
            };
          }),
      };
    }

    if (action === 'read_target') {
      const { targetType, id, title, parentTitle } = payload;
      if (targetType === 'global') {
        const text = getGlobalMessage();
        const catalog = await getPluginCatalog();
        const hist = JSON.parse(localStorage.getItem('TM_useStateUpdateHistory') || '{}');
        return {
          targetType: 'global',
          instruction: text,
          length: text.length,
          updatedAt: hist.defaultSystemMessage || null,
          enabledPlugins: catalog.filter((p) => p.globallyEnabled).map((p) => p.title),
          availablePlugins: catalog,
        };
      }
      if (targetType === 'agent') {
        const chars = await getCharacters();
        const agent = findAgent(chars, { id, title });
        if (!agent) throw new Error(`Agent not found (id=${id || ''}, title=${title || ''})`);
        const catalog = await getPluginCatalog();
        return {
          targetType: 'agent',
          id: agent.id,
          title: agent.title,
          color: agent.color || null,
          avatarURL: agent.avatarURL || null,
          description: agent.description || '',
          categories: agent.categories || [],
          isEnforceAssignedPlugins: Boolean(agent.isEnforceAssignedPlugins),
          assignedPlugins: formatAgentAssignedPlugins(agent.assignedPlugins, catalog),
          instruction: agent.instruction || '',
          length: (agent.instruction || '').length,
          syncedAt: agent.syncedAt || null,
        };
      }
      if (targetType === 'folder') {
        const folders = getFolders();
        const { getEffectiveParent, getEffectiveDepth, getPath } = buildFolderIndex(folders);
        const folder = findFolder(folders, { id, title, parentTitle });
        if (!folder) throw new Error(`Folder not found (id=${id || ''}, title=${title || ''})`);
        const chars = await getCharacters();
        const charById = Object.fromEntries(chars.map((c) => [c.id, c]));
        const agentID = folder.settings?.assignedAgentID || null;
        const sysMsg = folder.settings?.systemMessage || '';
        const effParent = getEffectiveParent(folder);
        return {
          targetType: 'folder',
          id: folder.id,
          title: folder.title,
          path: getPath(folder),
          depth: getEffectiveDepth(folder),
          parentID: effParent ? effParent.id : null,
          parentTitle: effParent ? effParent.title : null,
          assignedAgentID: agentID,
          assignedAgentTitle: agentID ? charById[agentID]?.title || null : null,
          instruction: sysMsg,
          length: sysMsg.length,
          updatedAt: folder.updatedAt || null,
        };
      }
      throw new Error(`Invalid targetType: ${targetType}`);
    }

    if (action === 'write_target') {
      const {
        targetType,
        id,
        title,
        parentTitle,
        instruction,
        newTitle,
        assignedAgentID,
        assignedAgentTitle,
        categories,
        avatarURL,
        avatarColor,
        avatarShape,
        avatarLabel,
        isEnforceAssignedPlugins,
        assignedPlugins,
        enabledPlugins,
        autoReload = true,
      } = payload;

      if (targetType === 'global') {
        if (typeof instruction !== 'string' && !Array.isArray(enabledPlugins)) {
          throw new Error('Either instruction string or enabledPlugins array is required for global write');
        }
        if (typeof instruction === 'string') {
          saveGlobalMessage(instruction, nowISO);
        }
        let updatedEnabledTitles = undefined;
        if (Array.isArray(enabledPlugins)) {
          const catalog = await getPluginCatalog();
          const resolved = resolveCatalogEntries(enabledPlugins, catalog);
          const newMap = {};
          for (const entry of resolved) {
            newMap[entry.id] = { enabled: true };
          }
          saveEnabledPluginsMap(newMap);
          updatedEnabledTitles = resolved.map((r) => r.title);
        }
        const currentInstruction = getGlobalMessage();
        if (autoReload) scheduleAutoReload();
        return {
          ok: true,
          targetType: 'global',
          length: currentInstruction.length,
          ...(updatedEnabledTitles !== undefined ? { enabledPlugins: updatedEnabledTitles } : {}),
          updatedAt: nowISO,
          reloadScheduled: !!autoReload,
        };
      }

      if (targetType === 'agent') {
        const chars = await getCharacters();
        const agent = findAgent(chars, { id, title });
        if (!agent) throw new Error(`Agent not found (id=${id || ''}, title=${title || ''})`);
        if (typeof instruction === 'string') agent.instruction = instruction;
        if (typeof newTitle === 'string' && newTitle.trim()) agent.title = newTitle.trim();
        if (Array.isArray(categories)) agent.categories = categories;
        if (avatarURL || avatarColor || avatarShape || avatarLabel !== undefined) {
          const resolved = resolveAgentAvatar(agent.title, { avatarURL, avatarColor, avatarShape, avatarLabel });
          agent.avatarURL = resolved.avatarURL;
          agent.color = resolved.color;
        }
        const catalog = await getPluginCatalog();
        if (Array.isArray(assignedPlugins)) {
          const resolved = resolveCatalogEntries(assignedPlugins, catalog);
          agent.assignedPlugins = buildAssignedPluginsMap(resolved);
          if (typeof isEnforceAssignedPlugins !== 'boolean') {
            agent.isEnforceAssignedPlugins = true;
          }
        }
        if (typeof isEnforceAssignedPlugins === 'boolean') {
          agent.isEnforceAssignedPlugins = isEnforceAssignedPlugins;
        }
        agent.syncedAt = null;
        agent.lastUsedAt = nowISO;

        await saveCharacters(chars);
        await appendCharacterVersion(agent);
        if (autoReload) scheduleAutoReload();
        return {
          ok: true,
          targetType: 'agent',
          id: agent.id,
          title: agent.title,
          color: agent.color || null,
          avatarURL: agent.avatarURL || null,
          isEnforceAssignedPlugins: Boolean(agent.isEnforceAssignedPlugins),
          assignedPlugins: formatAgentAssignedPlugins(agent.assignedPlugins, catalog).map((p) => p.title),
          length: (agent.instruction || '').length,
          reloadScheduled: !!autoReload,
        };
      }

      if (targetType === 'folder') {
        const folders = getFolders();
        const folder = findFolder(folders, { id, title, parentTitle });
        if (!folder) throw new Error(`Folder not found (id=${id || ''}, title=${title || ''})`);

        if (!folder.settings || typeof folder.settings !== 'object') {
          folder.settings = {
            files: [],
            model: null,
            systemMessage: '',
            assignedAgentID: null,
            dynamicContextEndpoints: [],
          };
        }
        if (typeof instruction === 'string') {
          folder.settings.systemMessage = instruction;
        }
        if (typeof newTitle === 'string' && newTitle.trim()) {
          folder.title = newTitle.trim();
        }
        if (assignedAgentID !== undefined || assignedAgentTitle !== undefined) {
          if (assignedAgentID === null || assignedAgentID === '' || assignedAgentTitle === null || assignedAgentTitle === '') {
            folder.settings.assignedAgentID = null;
          } else {
            const chars = await getCharacters();
            const ag = findAgent(chars, { id: assignedAgentID, title: assignedAgentTitle });
            if (!ag) throw new Error(`Assigned agent not found (${assignedAgentID || assignedAgentTitle})`);
            folder.settings.assignedAgentID = ag.id;
          }
        }
        folder.updatedAt = nowISO;

        // Clean any stale duplicate inside legacy parent.children arrays
        for (const f of folders) {
          if (Array.isArray(f.children) && f.children.length > 0) {
            f.children = [];
          }
        }

        saveFolders(folders);
        if (autoReload) scheduleAutoReload();
        const { getPath } = buildFolderIndex(folders);
        return {
          ok: true,
          targetType: 'folder',
          id: folder.id,
          title: folder.title,
          path: getPath(folder),
          assignedAgentID: folder.settings.assignedAgentID || null,
          length: (folder.settings.systemMessage || '').length,
          updatedAt: nowISO,
          reloadScheduled: !!autoReload,
        };
      }

      throw new Error(`Invalid targetType: ${targetType}`);
    }

    if (action === 'create_target') {
      const {
        targetType,
        title,
        instruction = '',
        parentID,
        parentTitle,
        assignedAgentID,
        assignedAgentTitle,
        categories,
        avatarURL,
        avatarColor,
        avatarShape,
        avatarLabel,
        isEnforceAssignedPlugins,
        assignedPlugins,
        autoReload = true,
      } = payload;
      if (!title || !String(title).trim()) throw new Error('title is required to create a target');

      if (targetType === 'agent') {
        const chars = await getCharacters();
        const existing = findAgent(chars, { title });
        if (existing) throw new Error(`Agent with title "${title}" already exists (id=${existing.id}). Use tm_write_target instead.`);

        const cleanTitle = String(title).trim();
        const resolvedAvatar = resolveAgentAvatar(cleanTitle, { avatarURL, avatarColor, avatarShape, avatarLabel });
        const catalog = await getPluginCatalog();
        let initialAssignedMap = {};
        let initialEnforce = Boolean(isEnforceAssignedPlugins);
        if (Array.isArray(assignedPlugins)) {
          const resolved = resolveCatalogEntries(assignedPlugins, catalog);
          initialAssignedMap = buildAssignedPluginsMap(resolved);
          if (typeof isEnforceAssignedPlugins !== 'boolean') {
            initialEnforce = true;
          }
        }

        const newId = `a-${crypto.randomUUID()}`;
        const newAgent = {
          id: newId,
          type: 'user',
          color: resolvedAvatar.color,
          title: cleanTitle,
          pinned: false,
          syncedAt: null,
          userTags: [],
          avatarURL: resolvedAvatar.avatarURL,
          createdAt: nowISO,
          deletedAt: null,
          categories: Array.isArray(categories) && categories.length ? categories : ['Instructions'],
          lastUsedAt: nowISO,
          description: '',
          instruction: String(instruction || ''),
          defaultModel: null,
          appliedLimits: [],
          trainingFiles: [],
          welcomeMessage: '',
          assignedPlugins: initialAssignedMap,
          trainingDataTags: [],
          trainingExamples: [],
          conversationStarters: [],
          isEnforceDefaultModel: false,
          isExcludedForUserTags: false,
          temporaryChatByDefault: false,
          dynamicContextEndpoints: [],
          isEnforceSpeechSettings: false,
          isEnforceAssignedPlugins: initialEnforce,
          isEnforceModelParameters: false,
          trainingDataAcessibility: 'NONE',
          overrideSystemInstruction: false,
        };

        chars.push(newAgent);
        await saveCharacters(chars);
        await appendCharacterVersion(newAgent);
        if (autoReload) scheduleAutoReload();
        return {
          ok: true,
          targetType: 'agent',
          id: newAgent.id,
          title: newAgent.title,
          color: newAgent.color,
          avatarURL: newAgent.avatarURL,
          isEnforceAssignedPlugins: newAgent.isEnforceAssignedPlugins,
          assignedPlugins: formatAgentAssignedPlugins(newAgent.assignedPlugins, catalog).map((p) => p.title),
          length: newAgent.instruction.length,
          reloadScheduled: !!autoReload,
        };
      }

      if (targetType === 'folder') {
        const folders = getFolders();
        const { isGroupingRef, getEffectiveParent, getEffectiveDepth, getPath } = buildFolderIndex(folders);
        let parentFolder = null;
        if ((parentID || parentTitle) && !isGroupingRef({ id: parentID, title: parentTitle })) {
          parentFolder = findFolder(folders, { id: parentID, title: parentTitle });
          if (!parentFolder) throw new Error(`Parent folder not found (${parentID || parentTitle})`);
        }

        let resolvedAgentID = null;
        if (assignedAgentID || assignedAgentTitle) {
          const chars = await getCharacters();
          const ag = findAgent(chars, { id: assignedAgentID, title: assignedAgentTitle });
          if (!ag) throw new Error(`Assigned agent not found (${assignedAgentID || assignedAgentTitle})`);
          resolvedAgentID = ag.id;
        } else if (parentFolder && parentFolder.settings?.assignedAgentID) {
          resolvedAgentID = parentFolder.settings.assignedAgentID;
        }

        const computedDepth = !parentFolder ? 0 : parentFolder.parentID ? (parentFolder.depth || 0) + 1 : 0;

        const newFolder = {
          id: `fo-${crypto.randomUUID()}`,
          depth: computedDepth,
          order: folders.length,
          title: String(title).trim(),
          children: [],
          parentID: parentFolder ? parentFolder.id : undefined,
          settings: {
            files: [],
            model: null,
            systemMessage: String(instruction || ''),
            assignedAgentID: resolvedAgentID,
            dynamicContextEndpoints: [],
          },
          syncedAt: null,
          createdAt: nowISO,
          deletedAt: null,
          updatedAt: nowISO,
          childrenCount: 0,
        };
        if (!parentFolder) delete newFolder.parentID;

        folders.push(newFolder);
        saveFolders(folders);
        if (autoReload) scheduleAutoReload();
        const effParent = getEffectiveParent(newFolder);
        return {
          ok: true,
          targetType: 'folder',
          id: newFolder.id,
          title: newFolder.title,
          path: getPath(newFolder),
          depth: getEffectiveDepth(newFolder),
          parentID: effParent ? effParent.id : null,
          assignedAgentID: resolvedAgentID,
          length: newFolder.settings.systemMessage.length,
          reloadScheduled: !!autoReload,
        };
      }

      throw new Error(`Invalid targetType for create: ${targetType}`);
    }

    throw new Error(`Unknown action: ${action}`);
  }

  let writeChain = Promise.resolve();
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'TM_INST_REQ') return;
    const { reqId, action, payload } = e.data;
    writeChain = writeChain.then(async () => {
      try {
        const result = await handleRequest(action, payload);
        e.source.postMessage({ type: 'TM_INST_RES', reqId, ok: true, result }, '*');
      } catch (err) {
        e.source.postMessage({ type: 'TM_INST_RES', reqId, ok: false, error: String(err.message || err) }, '*');
      }
    });
  });

  async function ensureSystemAccessPluginSchema() {
    try {
      const plugins = await idbGet('TM_useInstalledPlugins');
      if (!Array.isArray(plugins)) return;
      const sysPlugin = plugins.find((p) => p && p.id === 'tm_system_access' && !p.deletedAt);
      if (!sysPlugin || !Array.isArray(sysPlugin.pluginFunctions)) return;
      const writeFn = sysPlugin.pluginFunctions.find((f) => f && f.name === 'tm_write_target');
      const listFn = sysPlugin.pluginFunctions.find((f) => f && f.name === 'tm_list_targets');
      if (
        writeFn &&
        writeFn.openaiSpec?.parameters?.properties?.assignedPlugins &&
        listFn &&
        String(listFn.code || '').includes('cleanFolders')
      ) {
        return;
      }

      if (listFn) {
        listFn.code = "async function tm_list_targets() {\n  const GROUPS = new Set(['systems', 'laboratory', 'hobbies', 'counseling']);\n  function cleanFolders(folders) {\n    if (!Array.isArray(folders)) return folders;\n    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));\n    const isGrp = (f) => f && !f.parentID && !f.assignedAgentID && !f.instructionLength && (GROUPS.has(String(f.title || '').trim().toLowerCase()) || folders.some((c) => c.parentID === f.id && (c.assignedAgentID || folders.some((gc) => gc.parentID === c.id))));\n    return folders.filter((f) => !isGrp(f)).map((f) => {\n      const p = f.parentID ? byId[f.parentID] : null;\n      const effP = p && !isGrp(p) ? p : null;\n      const parts = String(f.path || f.title || '').split(' / ');\n      if (parts.length > 1 && GROUPS.has(parts[0].trim().toLowerCase())) parts.shift();\n      return { ...f, path: parts.join(' / '), depth: effP ? 1 : 0, parentID: effP ? effP.id : null, parentTitle: effP ? effP.title : null };\n    });\n  }\n  return new Promise((resolve) => {\n    const reqId = Math.random().toString(36).slice(2);\n    const timer = setTimeout(() => resolve({ ok: false, error: 'Timeout waiting for tm-bridge.js extension on window.top' }), 5000);\n    window.addEventListener('message', function handler(e) {\n      if (e.data && e.data.type === 'TM_INST_RES' && e.data.reqId === reqId) {\n        window.removeEventListener('message', handler);\n        clearTimeout(timer);\n        if (e.data.ok && e.data.result && Array.isArray(e.data.result.folders)) {\n          e.data.result.folders = cleanFolders(e.data.result.folders);\n        }\n        resolve(e.data);\n      }\n    });\n    window.top.postMessage({ type: 'TM_INST_REQ', reqId, action: 'list_targets', payload: {} }, '*');\n  });\n}";
        if (listFn.openaiSpec) {
          listFn.openaiSpec.description =
            'List all Global, Agent, and Folder/Subfolder instruction targets in TypingMind, including available MCP servers/plugins, globally enabled plugins, per-agent assignedPlugins + isEnforceAssignedPlugins status, folder breadcrumb paths, and character lengths.';
        }
      }
      const readFn = sysPlugin.pluginFunctions.find((f) => f && f.name === 'tm_read_target');
      if (readFn) {
        readFn.code = "async function tm_read_target(args) {\n  const GROUPS = new Set(['systems', 'laboratory', 'hobbies', 'counseling']);\n  const payload = { ...(args || {}) };\n  if (payload.parentTitle && GROUPS.has(String(payload.parentTitle).trim().toLowerCase())) delete payload.parentTitle;\n  return new Promise((resolve) => {\n    const reqId = Math.random().toString(36).slice(2);\n    const timer = setTimeout(() => resolve({ ok: false, error: 'Timeout waiting for tm-bridge.js extension on window.top' }), 5000);\n    window.addEventListener('message', function handler(e) {\n      if (e.data && e.data.type === 'TM_INST_RES' && e.data.reqId === reqId) {\n        window.removeEventListener('message', handler);\n        clearTimeout(timer);\n        if (e.data.ok && e.data.result && e.data.result.targetType === 'folder') {\n          const r = e.data.result;\n          const parts = String(r.path || r.title || '').split(' / ');\n          if (parts.length > 1 && GROUPS.has(parts[0].trim().toLowerCase())) parts.shift();\n          r.path = parts.join(' / ');\n          if (r.parentTitle && GROUPS.has(String(r.parentTitle).trim().toLowerCase())) {\n            r.parentID = null;\n            r.parentTitle = null;\n            r.depth = 0;\n          }\n        }\n        resolve(e.data);\n      }\n    });\n    window.top.postMessage({ type: 'TM_INST_REQ', reqId, action: 'read_target', payload }, '*');\n  });\n}";
        if (readFn.openaiSpec) {
          readFn.openaiSpec.description =
            'Read the full instruction or project context text and metadata (including MCP server / plugin assignments) of a Global, Agent, or Folder target in TypingMind.';
        }
      }
      if (writeFn && writeFn.openaiSpec?.parameters?.properties) {
        writeFn.code = "async function tm_write_target(args) {\n  const GROUPS = new Set(['systems', 'laboratory', 'hobbies', 'counseling']);\n  const payload = { ...(args || {}) };\n  if (payload.parentTitle && GROUPS.has(String(payload.parentTitle).trim().toLowerCase())) delete payload.parentTitle;\n  return new Promise((resolve) => {\n    const reqId = Math.random().toString(36).slice(2);\n    const timer = setTimeout(() => resolve({ ok: false, error: 'Timeout waiting for tm-bridge.js extension on window.top' }), 5000);\n    window.addEventListener('message', function handler(e) {\n      if (e.data && e.data.type === 'TM_INST_RES' && e.data.reqId === reqId) {\n        window.removeEventListener('message', handler);\n        clearTimeout(timer);\n        if (e.data.ok && e.data.result && e.data.result.path) {\n          const parts = String(e.data.result.path).split(' / ');\n          if (parts.length > 1 && GROUPS.has(parts[0].trim().toLowerCase())) parts.shift();\n          e.data.result.path = parts.join(' / ');\n        }\n        resolve(e.data);\n      }\n    });\n    window.top.postMessage({ type: 'TM_INST_REQ', reqId, action: 'write_target', payload }, '*');\n  });\n}";
        writeFn.openaiSpec.description =
          "Update an existing Global, Agent, or Folder target's instruction / project context, agent MCP/plugin assignments, global enabled plugins, or folder assigned agent. Automatically refreshes TypingMind after the AI turn completes.";
        Object.assign(writeFn.openaiSpec.parameters.properties, {
          isEnforceAssignedPlugins: {
            type: 'boolean',
            description:
              "For agents only: when true ('Only use the selected plugins'), the agent overrides global plugins and only loads tools in assignedPlugins. Defaults to true when assignedPlugins is provided.",
          },
          assignedPlugins: {
            type: 'array',
            items: { type: 'string' },
            description:
              "For agents only: array of MCP server or plugin titles/IDs to assign to this agent (e.g. ['filesystem', 'shell', 'TypingMind System Access'], or [] for zero tools).",
          },
          enabledPlugins: {
            type: 'array',
            items: { type: 'string' },
            description:
              'For global only: array of MCP server or plugin titles/IDs to enable globally in the workspace.',
          },
          avatarColor: {
            type: 'string',
            description: "For agents only: optional hex color (e.g. '#3B82F6') for the generated SVG avatar.",
          },
          avatarShape: {
            type: 'string',
            enum: ['dot', 'square'],
            description: "For agents only: optional shape ('dot' or 'square') for the generated SVG avatar.",
          },
          avatarLabel: {
            type: 'string',
            description: 'For agents only: optional 1-2 character label to render inside the SVG avatar (default is empty/solid shape).',
          },
          avatarURL: {
            type: 'string',
            description: 'For agents only: optional explicit avatar URL or data URI (overrides avatarColor/avatarShape).',
          },
        });
      }
      const createFn = sysPlugin.pluginFunctions.find((f) => f && f.name === 'tm_create_target');
      if (createFn && createFn.openaiSpec?.parameters?.properties) {
        createFn.code = "async function tm_create_target(args) {\n  const GROUPS = new Set(['systems', 'laboratory', 'hobbies', 'counseling']);\n  const payload = { ...(args || {}) };\n  if (payload.parentTitle && GROUPS.has(String(payload.parentTitle).trim().toLowerCase())) {\n    delete payload.parentTitle;\n    delete payload.parentID;\n  }\n  return new Promise((resolve) => {\n    const reqId = Math.random().toString(36).slice(2);\n    const timer = setTimeout(() => resolve({ ok: false, error: 'Timeout waiting for tm-bridge.js extension on window.top' }), 5000);\n    window.addEventListener('message', function handler(e) {\n      if (e.data && e.data.type === 'TM_INST_RES' && e.data.reqId === reqId) {\n        window.removeEventListener('message', handler);\n        clearTimeout(timer);\n        if (e.data.ok && e.data.result && e.data.result.path) {\n          const parts = String(e.data.result.path).split(' / ');\n          if (parts.length > 1 && GROUPS.has(parts[0].trim().toLowerCase())) parts.shift();\n          e.data.result.path = parts.join(' / ');\n        }\n        resolve(e.data);\n      }\n    });\n    window.top.postMessage({ type: 'TM_INST_REQ', reqId, action: 'create_target', payload }, '*');\n  });\n}";
        createFn.openaiSpec.description =
          'Create a new Agent or Folder/Subfolder in TypingMind with initial instructions/context, optional MCP/plugin assignments, and optional parent folder or assigned agent.';
        if (createFn.openaiSpec.parameters.properties.parentID) {
          createFn.openaiSpec.parameters.properties.parentID.description =
            "For project subfolders only: optional parent Category folder ID ('fo-...'). Omit when creating a top-level Category folder.";
        }
        if (createFn.openaiSpec.parameters.properties.parentTitle) {
          createFn.openaiSpec.parameters.properties.parentTitle.description =
            "For project subfolders only: optional parent Category folder title (e.g. 'Coding', 'AI/LLM Tooling', 'Making'). Omit when creating a top-level Category folder.";
        }
        Object.assign(createFn.openaiSpec.parameters.properties, {
          isEnforceAssignedPlugins: {
            type: 'boolean',
            description:
              "For agents only: when true ('Only use the selected plugins'), the agent overrides global plugins and only loads tools in assignedPlugins. Defaults to true when assignedPlugins is provided.",
          },
          assignedPlugins: {
            type: 'array',
            items: { type: 'string' },
            description:
              "For agents only: array of MCP server or plugin titles/IDs to assign to this agent (e.g. ['filesystem', 'shell', 'TypingMind System Access'], or [] for zero tools).",
          },
          avatarColor: {
            type: 'string',
            description: "For agents only: optional hex color (e.g. '#3B82F6') for the generated SVG avatar.",
          },
          avatarShape: {
            type: 'string',
            enum: ['dot', 'square'],
            description: "For agents only: optional shape ('dot' or 'square') for the generated SVG avatar.",
          },
          avatarLabel: {
            type: 'string',
            description: 'For agents only: optional 1-2 character label to render inside the SVG avatar (default is empty/solid shape).',
          },
          avatarURL: {
            type: 'string',
            description: 'For agents only: optional explicit avatar URL or data URI (overrides avatarColor/avatarShape).',
          },
        });
      }
      sysPlugin.syncedAt = null;
      await idbSet('TM_useInstalledPlugins', plugins);
      console.log('[TM Instructions Bridge] Auto-upgraded TypingMind System Access plugin schema in IndexedDB');
    } catch (e) {
      console.warn('[TM Instructions Bridge] Could not auto-upgrade plugin schema:', e);
    }
  }

  ensureSystemAccessPluginSchema();
  console.log('[TM Instructions Bridge] Loaded and listening on window.top');
})();
