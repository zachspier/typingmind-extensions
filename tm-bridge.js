(function () {
  if (window.__TM_INST_BRIDGE_LOADED__) return;
  window.__TM_INST_BRIDGE_LOADED__ = true;

  const state = {
    pendingGlobal: undefined,
    pendingFolders: undefined,
    pendingCharacters: undefined,
     pendingCharVersions: {},
    reloadTimer: null,
  };

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
    return Array.isArray(chars) ? chars : [];
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
    function getPath(f) {
      const parts = [f.title.trim()];
      let curr = f;
      let guard = 0;
      while (curr && curr.parentID && byId[curr.parentID] && guard < 10) {
        curr = byId[curr.parentID];
        parts.unshift(curr.title.trim());
        guard++;
      }
      return parts.join(' / ');
    }
    return { byId, getPath };
  }

  function findFolder(folders, { id, title, parentTitle }) {
    const { byId, getPath } = buildFolderIndex(folders);
    if (id && byId[id]) return byId[id];
    if (!title) return null;
    const norm = (s) => String(s || '').trim().toLowerCase();
    const targetTitle = norm(title);
    const targetParent = parentTitle ? norm(parentTitle) : null;

    const matches = folders.filter((f) => {
      if (norm(f.title) !== targetTitle && norm(getPath(f)) !== targetTitle) return false;
      if (targetParent) {
        const p = f.parentID ? byId[f.parentID] : null;
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
      const { byId, getPath } = buildFolderIndex(folders);
      const charById = Object.fromEntries(chars.map((c) => [c.id, c]));
      const hist = JSON.parse(localStorage.getItem('TM_useStateUpdateHistory') || '{}');

      return {
        global: {
          length: globalMsg.length,
          preview: globalMsg.slice(0, 160),
          updatedAt: hist.defaultSystemMessage || null,
        },
        agents: chars.map((c) => ({
          id: c.id,
          title: c.title,
          categories: c.categories || [],
          instructionLength: (c.instruction || '').length,
          instructionPreview: (c.instruction || '').slice(0, 140),
          syncedAt: c.syncedAt || null,
        })),
        folders: folders.map((f) => {
          const sysMsg = f.settings?.systemMessage || '';
          const agentID = f.settings?.assignedAgentID || null;
          return {
            id: f.id,
            title: f.title,
            path: getPath(f),
            depth: f.depth,
            parentID: f.parentID || null,
            parentTitle: f.parentID ? byId[f.parentID]?.title || null : null,
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
        const hist = JSON.parse(localStorage.getItem('TM_useStateUpdateHistory') || '{}');
        return { targetType: 'global', instruction: text, length: text.length, updatedAt: hist.defaultSystemMessage || null };
      }
      if (targetType === 'agent') {
        const chars = await getCharacters();
        const agent = findAgent(chars, { id, title });
        if (!agent) throw new Error(`Agent not found (id=${id || ''}, title=${title || ''})`);
        return {
          targetType: 'agent',
          id: agent.id,
          title: agent.title,
          description: agent.description || '',
          categories: agent.categories || [],
          instruction: agent.instruction || '',
          length: (agent.instruction || '').length,
          syncedAt: agent.syncedAt || null,
        };
      }
      if (targetType === 'folder') {
        const folders = getFolders();
        const { byId, getPath } = buildFolderIndex(folders);
        const folder = findFolder(folders, { id, title, parentTitle });
        if (!folder) throw new Error(`Folder not found (id=${id || ''}, title=${title || ''})`);
        const chars = await getCharacters();
        const charById = Object.fromEntries(chars.map((c) => [c.id, c]));
        const agentID = folder.settings?.assignedAgentID || null;
        const sysMsg = folder.settings?.systemMessage || '';
        return {
          targetType: 'folder',
          id: folder.id,
          title: folder.title,
          path: getPath(folder),
          depth: folder.depth,
          parentID: folder.parentID || null,
          parentTitle: folder.parentID ? byId[folder.parentID]?.title || null : null,
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
      const { targetType, id, title, parentTitle, instruction, newTitle, assignedAgentID, assignedAgentTitle, categories, autoReload = true } = payload;

      if (targetType === 'global') {
        if (typeof instruction !== 'string') throw new Error('instruction string is required for global write');
        saveGlobalMessage(instruction, nowISO);
        if (autoReload) scheduleAutoReload();
        return { ok: true, targetType: 'global', length: instruction.length, updatedAt: nowISO, reloadScheduled: !!autoReload };
      }

      if (targetType === 'agent') {
        const chars = await getCharacters();
        const agent = findAgent(chars, { id, title });
        if (!agent) throw new Error(`Agent not found (id=${id || ''}, title=${title || ''})`);
        if (typeof instruction === 'string') agent.instruction = instruction;
        if (typeof newTitle === 'string' && newTitle.trim()) agent.title = newTitle.trim();
        if (Array.isArray(categories)) agent.categories = categories;
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

        // Also update inside any legacy parent.children array if duplicated
        for (const f of folders) {
          if (Array.isArray(f.children)) {
            const childCopy = f.children.find((c) => c.id === folder.id);
            if (childCopy) {
              childCopy.settings = JSON.parse(JSON.stringify(folder.settings));
              childCopy.title = folder.title;
              childCopy.updatedAt = nowISO;
            }
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
      const { targetType, title, instruction = '', parentID, parentTitle, assignedAgentID, assignedAgentTitle, categories, autoReload = true } = payload;
      if (!title || !String(title).trim()) throw new Error('title is required to create a target');

      if (targetType === 'agent') {
        const chars = await getCharacters();
        const existing = findAgent(chars, { title });
        if (existing) throw new Error(`Agent with title "${title}" already exists (id=${existing.id}). Use tm_write_target instead.`);

        const newId = `a-${crypto.randomUUID()}`;
        const newAgent = {
          id: newId,
          type: 'user',
          color: '#fff',
          title: String(title).trim(),
          pinned: false,
          syncedAt: null,
          userTags: [],
          avatarURL: 'https://www.typingmind.com/assets/ai-characters/dorian.webp',
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
          assignedPlugins: {},
          trainingDataTags: [],
          trainingExamples: [],
          conversationStarters: [],
          isEnforceDefaultModel: false,
          isExcludedForUserTags: false,
          temporaryChatByDefault: false,
          dynamicContextEndpoints: [],
          isEnforceSpeechSettings: false,
          isEnforceAssignedPlugins: false,
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
          length: newAgent.instruction.length,
          reloadScheduled: !!autoReload,
        };
      }

      if (targetType === 'folder') {
        const folders = getFolders();
        let parentFolder = null;
        if (parentID || parentTitle) {
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

        // Match TypingMind's depth convention:
        // Top-level category: parentID = null, depth = 0
        // Folder inside top-level category: parentID = category.id, depth = 0
        // Subfolder inside a folder that already has a parentID: depth = parent.depth + 1 (i.e. 1)
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
        const { getPath } = buildFolderIndex(folders);
        return {
          ok: true,
          targetType: 'folder',
          id: newFolder.id,
          title: newFolder.title,
          path: getPath(newFolder),
          depth: newFolder.depth,
          parentID: newFolder.parentID || null,
          assignedAgentID: resolvedAgentID,
          length: newFolder.settings.systemMessage.length,
          reloadScheduled: !!autoReload,
        };
      }

      throw new Error(`Invalid targetType for create: ${targetType}`);
    }

    throw new Error(`Unknown action: ${action}`);
  }

  window.addEventListener('message', async (e) => {
    if (!e.data || e.data.type !== 'TM_INST_REQ') return;
    const { reqId, action, payload } = e.data;
    try {
      const result = await handleRequest(action, payload);
      e.source.postMessage({ type: 'TM_INST_RES', reqId, ok: true, result }, '*');
    } catch (err) {
      e.source.postMessage({ type: 'TM_INST_RES', reqId, ok: false, error: String(err.message || err) }, '*');
    }
  });

  console.log('[TM Instructions Bridge] Loaded and listening on window.top');
})();
