'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  patterns: [
    '/^Finanzblick\\s+\\d+$/i',
    '/^Documents Storage\\s+\\d+$/i'
  ],
  desktopEnabled: true,
  notifyWhenActive: true,
  ntfyEnabled: false,
  ntfyTopic: '',
  ntfyToken: '',
  ntfyIncludeChatLink: true,
  stabilityWindowMs: 1700
});

const MAX_LOGS = 300;
const RUNTIME_STATES_KEY = 'runtimeStates';
const NOTIFICATION_TARGETS_KEY = 'notificationTargets';
const RECENT_COMPLETIONS_KEY = 'recentCompletions';
const RUNNING_STATES = new Set(['active', 'verifying']);
const CONTENT_STATUS_TIMEOUT_MS = 650;

let runtimeStates = {};
let notificationTargets = {};
let recentCompletions = {};
let logWriteChain = Promise.resolve();

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTitle(value) {
  let title = normalize(value);
  title = title.replace(/^chatgpt\s*[|—–-]\s*/i, '');
  title = title.replace(/\s*[|—–-]\s*chatgpt$/i, '');
  return title || 'ChatGPT';
}

function wildcardRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function parseRegexPattern(pattern) {
  const trimmed = normalize(pattern);
  if (!trimmed.startsWith('/')) return null;
  const lastSlash = trimmed.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const source = trimmed.slice(1, lastSlash);
  const flags = trimmed.slice(lastSlash + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) return null;
  try {
    return new RegExp(source, flags);
  } catch (_) {
    return null;
  }
}

function titleMatchesPattern(title, pattern) {
  const trimmed = normalize(pattern);
  if (!trimmed) return false;
  const regex = parseRegexPattern(trimmed);
  if (regex) return regex.test(title);
  try {
    return wildcardRegex(trimmed).test(title);
  } catch (_) {
    return false;
  }
}

function matchTitleRule(title, settings) {
  if (!settings.enabled) return null;
  for (const pattern of (settings.patterns || [])) {
    if (titleMatchesPattern(title, pattern)) return pattern;
  }
  return null;
}

function isTitleInScope(title, settings) {
  return Boolean(matchTitleRule(title, settings));
}

async function getSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

async function ensureDefaultSettings() {
  const result = await chrome.storage.local.get(['settings']);
  if (!result.settings) {
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
    return;
  }
  const merged = { ...DEFAULT_SETTINGS, ...result.settings };
  await chrome.storage.local.set({ settings: merged });
}

function isRunningState(state) {
  return RUNNING_STATES.has(state);
}

async function withTimeout(promise, timeoutMs, fallbackValue = null) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallbackValue), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getContentStatusWithTimeout(tabId) {
  try {
    return await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT_STATUS' }),
      CONTENT_STATUS_TIMEOUT_MS,
      null
    );
  } catch (_) {
    return null;
  }
}

async function updateBadge(settings = null) {
  const effectiveSettings = settings || await getSettings();
  let runningCount = 0;

  for (const runtimeState of Object.values(runtimeStates)) {
    const title = sanitizeTitle(runtimeState.title);
    const matchedRule = matchTitleRule(title, effectiveSettings);
    runtimeState.inScope = Boolean(matchedRule);
    runtimeState.matchedRule = matchedRule;
    if (runtimeState.inScope && isRunningState(runtimeState.state)) runningCount += 1;
  }

  await chrome.action.setBadgeText({ text: runningCount ? String(runningCount) : '' });
  return runningCount;
}

async function collectMonitoredTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({
    url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
  });

  const tabStatuses = await Promise.all(
    tabs.map(async (tab) => ({
      tab,
      contentStatus: tab.id ? await getContentStatusWithTimeout(tab.id) : null
    }))
  );

  const monitored = [];

  for (const { tab, contentStatus } of tabStatuses) {
    if (!tab.id) continue;

    const stored = runtimeStates[String(tab.id)] || {};
    const detectorAvailable = Boolean(contentStatus);
    const title = sanitizeTitle(contentStatus?.title || stored.title || tab.title);
    const matchedRule = matchTitleRule(title, settings);
    if (!matchedRule) continue;

    if (!detectorAvailable && stored.detectorAvailable !== false) {
      await addLog('content-detector-unavailable', {
        tabId: tab.id,
        title,
        previousState: stored.state || null
      });
    } else if (detectorAvailable && stored.detectorAvailable === false) {
      await addLog('content-detector-restored', {
        tabId: tab.id,
        title,
        state: contentStatus?.state || null
      });
    }

    const state = detectorAvailable
      ? (contentStatus?.state || stored.state || 'idle')
      : 'unavailable';
    const url = contentStatus?.url || stored.url || tab.url || 'https://chatgpt.com/';
    const titleSource = contentStatus?.titleSource || stored.titleSource || 'browser-tab';
    const lastEvent = contentStatus?.lastEvent || stored.lastEvent || null;
    const lastDelivery = contentStatus?.lastDelivery || stored.lastDelivery || null;

    runtimeStates[String(tab.id)] = {
      ...stored,
      state,
      title,
      url,
      inScope: true,
      matchedRule,
      titleSource,
      lastEvent,
      detectorAvailable,
      updatedAt: Date.now()
    };

    monitored.push({
      tabId: tab.id,
      windowId: tab.windowId,
      title,
      url,
      state,
      detectorAvailable,
      running: detectorAvailable && isRunningState(state),
      active: Boolean(tab.active),
      matchedRule,
      lastEvent,
      lastDelivery
    });
  }

  monitored.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  await persistSession();
  const runningCount = await updateBadge(settings);

  return { tabs: monitored, runningCount };
}

async function addLog(event, details = {}) {
  logWriteChain = logWriteChain
    .catch(() => {})
    .then(async () => {
      const result = await chrome.storage.local.get(['logs']);
      const logs = Array.isArray(result.logs) ? result.logs : [];
      logs.unshift({
        at: new Date().toISOString(),
        event,
        ...details
      });
      await chrome.storage.local.set({ logs: logs.slice(0, MAX_LOGS) });
    });
  return logWriteChain;
}

function sanitizeDiagnosticDetails(details = {}) {
  const allowedKeys = new Set([
    'source', 'from', 'to', 'reason', 'composerRole',
    'stopPresent', 'sendPresent', 'assistantPresent', 'errorPresent',
    'stopSeen', 'sawAssistantActivity', 'manualStop', 'delayMs',
    'result', 'inScope', 'desktop', 'ntfy'
  ]);
  const clean = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (!allowedKeys.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || value === null || value === undefined) {
      clean[key] = value;
    }
  }
  return clean;
}

async function collectDiagnostics(tabId) {
  const settings = await getSettings();
  const storage = await chrome.storage.local.get(['logs']);
  const logs = Array.isArray(storage.logs) ? storage.logs : [];
  const numericTabId = Number(tabId);
  const hasTabId = Number.isFinite(numericTabId);

  let contentStatus = null;
  let tab = null;
  if (hasTabId) {
    try {
      tab = await chrome.tabs.get(numericTabId);
    } catch (_) {
      tab = null;
    }
    contentStatus = await getContentStatusWithTimeout(numericTabId);
  }

  let releaseVersion = null;
  try {
    const response = await fetch(chrome.runtime.getURL('release.json'), { cache: 'no-store' });
    if (response.ok) {
      const release = await response.json();
      releaseVersion = normalize(release.version) || null;
    }
  } catch (_) {
    releaseVersion = null;
  }

  const selectedLogs = logs
    .filter((entry) => !hasTabId || entry.tabId === numericTabId || entry.tabId == null)
    .slice(0, 220);

  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    releaseVersion,
    tabId: hasTabId ? numericTabId : null,
    tab: tab ? {
      title: sanitizeTitle(tab.title),
      url: tab.url || null,
      active: Boolean(tab.active),
      windowId: tab.windowId
    } : null,
    contentStatus,
    runtimeState: hasTabId ? (runtimeStates[String(numericTabId)] || null) : null,
    settings: {
      enabled: settings.enabled,
      patterns: Array.isArray(settings.patterns) ? settings.patterns : [],
      desktopEnabled: settings.desktopEnabled,
      notifyWhenActive: settings.notifyWhenActive,
      ntfyEnabled: settings.ntfyEnabled,
      ntfyConfigured: Boolean(normalize(settings.ntfyTopic)),
      ntfyTokenConfigured: Boolean(normalize(settings.ntfyToken)),
      ntfyIncludeChatLink: settings.ntfyIncludeChatLink,
      stabilityWindowMs: settings.stabilityWindowMs
    },
    logs: selectedLogs
  };
}

async function persistSession() {
  await chrome.storage.session.set({
    [RUNTIME_STATES_KEY]: runtimeStates,
    [NOTIFICATION_TARGETS_KEY]: notificationTargets,
    [RECENT_COMPLETIONS_KEY]: recentCompletions
  });
}

async function restoreSession() {
  const result = await chrome.storage.session.get([
    RUNTIME_STATES_KEY,
    NOTIFICATION_TARGETS_KEY,
    RECENT_COMPLETIONS_KEY
  ]);
  runtimeStates = result[RUNTIME_STATES_KEY] || {};
  notificationTargets = result[NOTIFICATION_TARGETS_KEY] || {};
  recentCompletions = result[RECENT_COMPLETIONS_KEY] || {};
}

function pruneRecentCompletions() {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [key, timestamp] of Object.entries(recentCompletions)) {
    if (!Number.isFinite(timestamp) || timestamp < cutoff) delete recentCompletions[key];
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) return 'under 1 second';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function showDesktopNotification({ tabId, title, url, durationMs }) {
  const notificationId = `chatgpt-notifier:${tabId}:${Date.now()}`;
  notificationTargets[notificationId] = { tabId, url, createdAt: Date.now() };
  await persistSession();

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icon128.png'),
      title: `ChatGPT — ${title}`,
      message: `Response completed in ${formatDuration(durationMs)}.`,
      priority: 2
    });
    await addLog('desktop-notification-created', { tabId, title, notificationId });
    return notificationId;
  } catch (error) {
    await addLog('desktop-notification-error', {
      tabId,
      title,
      message: String(error?.message || error)
    });
    throw error;
  }
}

async function publishNtfy(settings, { title, url, durationMs }) {
  if (!settings.ntfyEnabled || !normalize(settings.ntfyTopic)) return { skipped: true };

  const headers = { 'Content-Type': 'application/json' };
  if (normalize(settings.ntfyToken)) {
    headers.Authorization = `Bearer ${normalize(settings.ntfyToken)}`;
  }

  const body = {
    topic: normalize(settings.ntfyTopic),
    title: `ChatGPT — ${title}`,
    message: `Response completed in ${formatDuration(durationMs)}.`,
    priority: 3,
    tags: ['white_check_mark']
  };

  if (settings.ntfyIncludeChatLink && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(url || '')) {
    body.click = url;
  }

  const response = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ntfy HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }

  return { skipped: false };
}

async function processCompletion(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return { ok: false, reason: 'missing-tab' };

  const settings = await getSettings();
  const title = sanitizeTitle(message.title || sender.tab?.title);
  const url = message.url || sender.tab?.url || 'https://chatgpt.com/';
  const cycleKey = `${tabId}:${message.cycleId}`;

  await addLog('completion-received', {
    tabId,
    title,
    cycleId: message.cycleId,
    durationMs: message.durationMs
  });

  pruneRecentCompletions();
  if (recentCompletions[cycleKey]) {
    await addLog('completion-duplicate-suppressed', { tabId, title, cycleId: message.cycleId });
    return { ok: true, duplicate: true };
  }
  recentCompletions[cycleKey] = Date.now();
  await persistSession();

  const matchedRule = matchTitleRule(title, settings);
  const inScope = Boolean(matchedRule);
  runtimeStates[String(tabId)] = {
    ...(runtimeStates[String(tabId)] || {}),
    state: 'completed',
    title,
    url,
    inScope,
    matchedRule,
    titleSource: message.titleSource || null,
    rawDocumentTitle: message.rawDocumentTitle || null,
    cycleId: message.cycleId,
    lastEvent: 'generation-completed',
    updatedAt: Date.now()
  };
  await persistSession();

  if (!inScope) {
    await updateBadge(settings);
    await addLog('completion-out-of-scope', { tabId, title, cycleId: message.cycleId });
    return { ok: true, inScope: false };
  }

  await addLog('completion-in-scope', {
    tabId,
    title,
    cycleId: message.cycleId,
    matchedRule
  });

  const results = { desktop: 'disabled', ntfy: 'disabled' };

  if (settings.desktopEnabled) {
    await addLog('desktop-delivery-start', { tabId, title, cycleId: message.cycleId });
    if (!settings.notifyWhenActive) {
      const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTabs.some((tab) => tab.id === tabId)) {
        results.desktop = 'suppressed-active';
        await addLog('desktop-delivery-suppressed-active', { tabId, title, cycleId: message.cycleId });
      } else {
        await showDesktopNotification({ tabId, title, url, durationMs: message.durationMs });
        results.desktop = 'sent';
      }
    } else {
      await showDesktopNotification({ tabId, title, url, durationMs: message.durationMs });
      results.desktop = 'sent';
    }
  }

  if (settings.ntfyEnabled) {
    try {
      await addLog('ntfy-delivery-start', { tabId, title, cycleId: message.cycleId });
      await publishNtfy(settings, { title, url, durationMs: message.durationMs });
      results.ntfy = 'sent';
      await addLog('ntfy-delivery-sent', { tabId, title, cycleId: message.cycleId });
    } catch (error) {
      results.ntfy = 'failed';
      await addLog('ntfy-error', { tabId, title, message: String(error?.message || error) });
    }
  }

  const deliveryAt = Date.now();
  const deliveryState = {
    ...(runtimeStates[String(tabId)] || {}),
    lastDesktopDelivery: results.desktop,
    lastNtfyDelivery: results.ntfy,
    lastDeliveryAt: deliveryAt
  };
  if (results.desktop === 'sent') deliveryState.lastSuccessfulDesktopAt = deliveryAt;
  if (results.ntfy === 'sent') deliveryState.lastSuccessfulNtfyAt = deliveryAt;
  if (results.desktop === 'sent' || results.ntfy === 'sent') {
    deliveryState.lastSuccessfulNotificationAt = deliveryAt;
  }
  runtimeStates[String(tabId)] = deliveryState;
  await persistSession();

  await updateBadge(settings);

  await addLog('completion-notified', {
    tabId,
    title,
    cycleId: message.cycleId,
    desktop: results.desktop,
    ntfy: results.ntfy
  });

  return { ok: true, inScope: true, results };
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaultSettings();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === 'STATUS_UPDATE') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false });
      return;
    }

    void (async () => {
      const settings = await getSettings();
      const title = sanitizeTitle(message.title || sender.tab?.title);
      const matchedRule = matchTitleRule(title, settings);
      runtimeStates[String(tabId)] = {
        ...(runtimeStates[String(tabId)] || {}),
        state: message.state,
        detectorAvailable: true,
        title,
        url: message.url || sender.tab?.url,
        inScope: Boolean(matchedRule),
        matchedRule,
        titleSource: message.titleSource || null,
        rawDocumentTitle: message.rawDocumentTitle || null,
        cycleId: message.cycleId,
        lastEvent: message.reason,
        updatedAt: message.timestamp || Date.now()
      };
      await persistSession();
      await updateBadge(settings);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'DIAGNOSTIC_EVENT') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, reason: 'missing-tab' });
      return;
    }
    void addLog('content:' + normalize(message.event), {
      tabId,
      title: sanitizeTitle(message.title || sender.tab?.title),
      cycleId: message.cycleId ?? null,
      state: message.state || null,
      titleSource: message.titleSource || null,
      ...sanitizeDiagnosticDetails(message.details)
    }).then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'GENERATION_COMPLETE') {
    void processCompletion(message, sender).then(sendResponse).catch(async (error) => {
      await addLog('completion-handler-error', { message: String(error?.message || error) });
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === 'GET_MONITORED_TABS') {
    void collectMonitoredTabs()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'FOCUS_TAB') {
    void (async () => {
      const tabId = Number(message.tabId);
      if (!Number.isFinite(tabId)) throw new Error('Invalid tab id');
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'GET_DIAGNOSTICS') {
    void collectDiagnostics(message.tabId)
      .then((diagnostics) => sendResponse({ ok: true, diagnostics }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'GET_TAB_STATUS') {
    void (async () => {
      const tabId = message.tabId;
      const settings = await getSettings();
      const stored = runtimeStates[String(tabId)] || {};
      const title = sanitizeTitle(stored.title || message.title);
      const matchedRule = matchTitleRule(title, settings);
      sendResponse({
        ...stored,
        title,
        inScope: Boolean(matchedRule),
        matchedRule,
        settings: {
          enabled: settings.enabled,
          desktopEnabled: settings.desktopEnabled,
          ntfyEnabled: settings.ntfyEnabled
        }
      });
    })();
    return true;
  }

  if (message.type === 'TEST_DESKTOP') {
    void (async () => {
      const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const tab = activeTabs[0];
      await showDesktopNotification({
        tabId: tab?.id || 0,
        title: 'Test notification',
        url: tab?.url || 'https://chatgpt.com/',
        durationMs: 123000
      });
      await addLog('desktop-test-sent');
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'TEST_NTFY') {
    void (async () => {
      const settings = await getSettings();
      if (!settings.ntfyEnabled || !normalize(settings.ntfyTopic)) {
        sendResponse({ ok: false, error: 'Enable ntfy and configure a topic first.' });
        return;
      }
      await publishNtfy(settings, {
        title: 'Test notification',
        url: 'https://chatgpt.com/',
        durationMs: 123000
      });
      await addLog('ntfy-test-sent');
      sendResponse({ ok: true });
    })().catch(async (error) => {
      await addLog('ntfy-test-error', { message: String(error?.message || error) });
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === 'CLEAR_LOGS') {
    void chrome.storage.local.set({ logs: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  void (async () => {
    const target = notificationTargets[notificationId];
    if (!target) return;

    try {
      const tab = await chrome.tabs.get(target.tabId);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (_) {
      if (target.url) await chrome.tabs.create({ url: target.url });
    }
    await chrome.notifications.clear(notificationId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete runtimeStates[String(tabId)];
  void (async () => {
    await persistSession();
    await updateBadge();
  })();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(changeInfo.url)) {
    void addLog('tab-chatgpt-navigation', {
      tabId,
      title: sanitizeTitle(tab?.title),
      url: changeInfo.url
    });
    return;
  }
  if (!runtimeStates[String(tabId)]) return;

  void addLog('tab-navigated-away', {
    tabId,
    title: sanitizeTitle(tab?.title),
    url: changeInfo.url
  });
  delete runtimeStates[String(tabId)];
  void (async () => {
    await persistSession();
    await updateBadge();
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  void (async () => {
    const settings = await getSettings();
    await updateBadge(settings);
    await persistSession();
  })();
});

void (async () => {
  await restoreSession();
  await ensureDefaultSettings();
  await updateBadge();
  await addLog('service-worker-start', {
    version: chrome.runtime.getManifest().version
  });
})();
