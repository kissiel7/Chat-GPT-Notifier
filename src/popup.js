'use strict';

const $ = (id) => document.getElementById(id);

const POPUP_MESSAGE_TIMEOUT_MS = 1800;
const RECOVERY_POLL_INTERVAL_MS = 700;
const RECOVERY_POLL_ATTEMPTS = 8;
const PANEL_PARAMS = new URLSearchParams(location.search);
const PANEL_MODE = PANEL_PARAMS.get('panel') === '1';
const PANEL_ORIGIN_TAB_ID = Number(PANEL_PARAMS.get('tabId'));
const PANEL_EDGE_MARGIN = 20;
const PANEL_INNER_WIDTH = 500;

let dashboardLoadInFlight = false;
let panelResizeTimer = null;
let lastPanelGeometry = null;
let currentRecoveryGeneration = 0;

let current = {
  tab: null,
  title: '',
  inScope: false,
  matchedRule: null,
  exactRule: null,
  isChatGpt: false,
  status: null
};

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

if (PANEL_MODE) {
  document.documentElement.classList.add('panel-window');
}

async function resolveContextTab() {
  if (PANEL_MODE && Number.isFinite(PANEL_ORIGIN_TAB_ID)) {
    try {
      return await chrome.tabs.get(PANEL_ORIGIN_TAB_ID);
    } catch (_) {
      // The origin tab may have been closed after the panel opened.
    }
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function resizeAdaptivePanel() {
  if (!PANEL_MODE) return;

  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow?.id == null) return;

    const chromeWidth = Math.max(0, window.outerWidth - window.innerWidth);
    const chromeHeight = Math.max(0, window.outerHeight - window.innerHeight);
    const desiredInnerHeight = Math.ceil(document.documentElement.scrollHeight + 2);
    const maxOuterHeight = Math.max(420, screen.availHeight - (PANEL_EDGE_MARGIN * 2));
    const maxOuterWidth = Math.max(420, screen.availWidth - (PANEL_EDGE_MARGIN * 2));
    const targetWidth = Math.min(PANEL_INNER_WIDTH + chromeWidth, maxOuterWidth);
    const targetHeight = Math.min(desiredInnerHeight + chromeHeight, maxOuterHeight);
    const targetLeft = Math.max(
      screen.availLeft,
      screen.availLeft + screen.availWidth - targetWidth - PANEL_EDGE_MARGIN
    );
    const targetTop = screen.availTop + PANEL_EDGE_MARGIN;

    const geometry = [targetLeft, targetTop, targetWidth, targetHeight].join(':');
    if (geometry === lastPanelGeometry) return;
    lastPanelGeometry = geometry;

    await chrome.windows.update(currentWindow.id, {
      left: Math.round(targetLeft),
      top: Math.round(targetTop),
      width: Math.round(targetWidth),
      height: Math.round(targetHeight)
    });
  } catch (_) {
    // Window sizing is best-effort; the notifier remains usable without it.
  }
}

function schedulePanelResize() {
  if (!PANEL_MODE) return;
  if (panelResizeTimer) clearTimeout(panelResizeTimer);
  panelResizeTimer = setTimeout(() => {
    panelResizeTimer = null;
    void resizeAdaptivePanel();
  }, 60);
}

function exactRegexRule(title) {
  const escaped = normalize(title)
    .replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')
    .replace(/\//g, '\\/');
  return '/^' + escaped + '$/i';
}

function showActionStatus(text, isError = false) {
  const element = $('actionStatus');
  element.textContent = text || '';
  element.className = isError ? 'status error' : 'status';
  schedulePanelResize();
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPersistentDetectorFailure(status) {
  if (status?.state !== 'unavailable') return false;
  return status?.lastEvent === 'detector-recovery-failed'
    || status?.lastEvent === 'detector-recovery-no-response';
}

function renderScopeButton() {
  const button = $('toggleScope');

  if (!current.isChatGpt || !current.title || current.title === 'ChatGPT') {
    button.disabled = true;
    button.textContent = 'Open a named ChatGPT conversation';
    return;
  }

  if (!current.inScope) {
    button.disabled = false;
    button.textContent = 'Monitor this chat';
    return;
  }

  if (current.matchedRule === current.exactRule) {
    button.disabled = false;
    button.textContent = 'Stop monitoring this chat';
    return;
  }

  button.disabled = true;
  button.textContent = 'Already monitored by a rule';
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function renderNotificationState(status) {
  const desktopEnabled = status?.settings?.desktopEnabled !== false;
  const ntfyEnabled = Boolean(status?.settings?.ntfyEnabled);
  const desktopLast = status?.lastDesktopDelivery;
  const ntfyLast = status?.lastNtfyDelivery;

  $('desktop').textContent = desktopEnabled
    ? (desktopLast ? 'On · last ' + desktopLast : 'On')
    : 'Off';

  $('ntfy').textContent = ntfyEnabled
    ? (ntfyLast ? 'On · last ' + ntfyLast : 'On')
    : 'Off';

  $('testDesktop').disabled = !desktopEnabled;
  $('testNtfy').disabled = !ntfyEnabled;
  $('lastDesktopSuccess').textContent = formatTimestamp(status?.lastSuccessfulDesktopAt);
  $('lastNtfySuccess').textContent = formatTimestamp(status?.lastSuccessfulNtfyAt);
}

function monitoredStateLabel(tab) {
  if (tab.state === 'recovering') return 'recovering detector…';
  if (tab.detectorAvailable === false || tab.state === 'unavailable') {
    return 'detector unavailable — recovery failed';
  }
  if (tab.running) return 'generating';
  if (tab.state === 'completed') return 'completed';
  if (tab.state === 'manual_stop') return 'stopped';
  if (tab.state === 'error') return 'error';
  return tab.state || 'idle';
}

function renderMonitoredTabs(result) {
  const tabs = Array.isArray(result?.tabs) ? result.tabs : [];
  const runningCount = Number(result?.runningCount) || 0;
  const list = $('monitoredTabs');
  list.replaceChildren();

  $('runningSummary').textContent = runningCount
    ? runningCount + ' running · ' + tabs.length + ' open'
    : tabs.length + ' open';

  if (!tabs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No monitored ChatGPT tabs are open.';
    list.appendChild(empty);
    schedulePanelResize();
    return;
  }

  for (const tab of tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-tab' + (tab.tabId === current.tab?.id ? ' current' : '');
    button.title = 'Switch to ' + tab.title;

    const indicator = document.createElement('span');
    indicator.className = 'chat-indicator' + (tab.running ? ' running' : '');
    indicator.textContent = tab.state === 'recovering'
      ? '↻'
      : (tab.detectorAvailable === false
        ? '!'
        : (tab.running ? '●' : (tab.state === 'completed' ? '✓' : '○')));

    const copy = document.createElement('span');
    copy.className = 'chat-copy';

    const title = document.createElement('strong');
    title.className = 'chat-title';
    title.textContent = tab.title;

    const state = document.createElement('span');
    state.className = 'chat-state';
    state.textContent = monitoredStateLabel(tab);

    copy.append(title, state);

    const currentMarker = document.createElement('span');
    currentMarker.className = 'chat-current';
    currentMarker.textContent = tab.tabId === current.tab?.id ? 'current' : '';

    button.append(indicator, copy, currentMarker);
    button.addEventListener('click', async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: tab.tabId });
        if (!response?.ok) throw new Error(response?.error || 'Could not focus tab');
        if (!PANEL_MODE) window.close();
      } catch (error) {
        showActionStatus(String(error?.message || error), true);
      }
    });

    list.appendChild(button);
  }
  schedulePanelResize();
}

async function loadMonitoredTabs() {
  if (dashboardLoadInFlight) return;
  dashboardLoadInFlight = true;

  try {
    const response = await withTimeout(
      chrome.runtime.sendMessage({ type: 'GET_MONITORED_TABS' }),
      POPUP_MESSAGE_TIMEOUT_MS,
      null
    );
    if (!response) throw new Error('Dashboard timed out');
    if (!response.ok) throw new Error(response.error || 'Could not load monitored tabs');
    renderMonitoredTabs(response);
  } catch (error) {
    $('runningSummary').textContent = 'unavailable';
    const list = $('monitoredTabs');
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty';
    const reason = String(error?.message || error);
    empty.textContent = reason === 'Dashboard timed out'
      ? 'Dashboard timed out. Detector recovery continues in the background.'
      : 'Dashboard unavailable: ' + reason;
    list.appendChild(empty);
  } finally {
    dashboardLoadInFlight = false;
  }
}
async function renderDeploymentState() {
  const manifestVersion = chrome.runtime.getManifest().version;
  $('version').textContent = 'v' + manifestVersion;

  try {
    const response = await fetch(chrome.runtime.getURL('release.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const release = await response.json();
    const markerVersion = normalize(release.version);

    if (markerVersion === manifestVersion) {
      $('deployment').textContent = 'OK · ' + markerVersion;
      $('deployment').className = 'good';
    } else {
      $('deployment').textContent = 'MISMATCH · manifest ' + manifestVersion + ' / marker ' + (markerVersion || '?');
      $('deployment').className = 'bad';
    }
  } catch (_) {
    $('deployment').textContent = 'marker missing';
    $('deployment').className = 'bad';
  }
}

async function getDirectContentStatus(tabId) {
  try {
    return await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT_STATUS' }),
      700,
      null
    );
  } catch (_) {
    return null;
  }
}

async function getContentStatus(tabId) {
  const direct = await getDirectContentStatus(tabId);
  if (direct) return direct;

  try {
    const recovery = await withTimeout(
      chrome.runtime.sendMessage({ type: 'ENSURE_CONTENT_DETECTOR', tabId }),
      POPUP_MESSAGE_TIMEOUT_MS,
      null
    );
    return recovery?.ok ? recovery.contentStatus : null;
  } catch (_) {
    return null;
  }
}

async function getBackgroundStatus(tab, contentStatus) {
  try {
    return await chrome.runtime.sendMessage({
      type: 'GET_TAB_STATUS',
      tabId: tab.id,
      title: contentStatus?.title || tab.title,
      url: tab.url
    });
  } catch (_) {
    return null;
  }
}

function applyCurrentTabStatus(tab, contentStatus, status) {
  current.status = status;

  const title = normalize(contentStatus?.title || status?.title || tab.title || 'ChatGPT');
  current.title = title;
  current.inScope = Boolean(status?.inScope);
  current.matchedRule = status?.matchedRule || null;
  current.exactRule = exactRegexRule(title);

  $('title').textContent = title;
  $('scope').textContent = current.inScope ? 'Yes' : 'No';
  $('scope').className = current.inScope ? 'good' : 'bad';
  $('matchedRule').textContent = current.matchedRule || '—';
  $('titleSource').textContent = contentStatus?.titleSource || status?.titleSource || (contentStatus ? 'content-script' : 'browser-tab');
  $('state').textContent = contentStatus?.state || status?.state || 'idle';
  $('event').textContent = contentStatus?.lastEvent || status?.lastEvent || '—';
  $('composer').textContent = contentStatus?.composerRole || '—';
  $('stopSeen').textContent = contentStatus?.stopSeen ? 'Yes' : (contentStatus?.cycleId ? 'No' : '—');
  $('delivery').textContent = contentStatus?.lastDelivery || '—';

  renderNotificationState(status);
  renderScopeButton();
}

async function followCurrentTabRecovery(tab, generation) {
  for (let attempt = 0; attempt < RECOVERY_POLL_ATTEMPTS; attempt += 1) {
    await delay(RECOVERY_POLL_INTERVAL_MS);
    if (generation !== currentRecoveryGeneration || current.tab?.id !== tab.id) return;

    const contentStatus = await getDirectContentStatus(tab.id);
    const status = await getBackgroundStatus(tab, contentStatus);

    if (contentStatus) {
      applyCurrentTabStatus(tab, contentStatus, status);
      showActionStatus('');
      return;
    }

    if (isPersistentDetectorFailure(status) && attempt >= 2) {
      showActionStatus('Detector unavailable. Automatic recovery failed; a manual page refresh may be required.', true);
      return;
    }

    showActionStatus('Recovering detector…');
  }

  if (generation !== currentRecoveryGeneration || current.tab?.id !== tab.id) return;
  const status = await getBackgroundStatus(tab, null);
  if (isPersistentDetectorFailure(status)) {
    showActionStatus('Detector unavailable. Automatic recovery failed; a manual page refresh may be required.', true);
  } else {
    showActionStatus('Detector recovery is still in progress…');
  }
}

async function load() {
  currentRecoveryGeneration += 1;
  const recoveryGeneration = currentRecoveryGeneration;
  await renderDeploymentState();

  try {
    const tab = await resolveContextTab();
    const isChatGpt = Boolean(tab && /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || ''));

    current = {
      tab,
      title: '',
      inScope: false,
      matchedRule: null,
      exactRule: null,
      isChatGpt,
      status: null
    };

    if (!isChatGpt) {
      $('title').textContent = 'Not a ChatGPT tab';
      $('scope').textContent = 'No';
      $('scope').className = 'bad';
      $('matchedRule').textContent = '—';
      $('titleSource').textContent = '—';
      $('state').textContent = '—';
      $('event').textContent = '—';
      $('composer').textContent = '—';
      $('stopSeen').textContent = '—';
      $('delivery').textContent = '—';
      $('desktop').textContent = '—';
      $('ntfy').textContent = '—';
      $('lastDesktopSuccess').textContent = '—';
      $('lastNtfySuccess').textContent = '—';
      $('testDesktop').disabled = false;
      $('testNtfy').disabled = true;
      renderScopeButton();
      await loadMonitoredTabs();
      return;
    }

    const contentStatus = await getContentStatus(tab.id);
    const status = await getBackgroundStatus(tab, contentStatus);
    applyCurrentTabStatus(tab, contentStatus, status);
    await loadMonitoredTabs();

    if (contentStatus) {
      showActionStatus('');
    } else if (isPersistentDetectorFailure(status)) {
      showActionStatus('Recovering detector…');
      void followCurrentTabRecovery(tab, recoveryGeneration);
    } else {
      showActionStatus('Recovering detector…');
      void followCurrentTabRecovery(tab, recoveryGeneration);
    }
  } catch (error) {
    showActionStatus('Popup error: ' + String(error?.message || error), true);
    $('toggleScope').disabled = true;
    $('toggleScope').textContent = 'Popup unavailable';
    await loadMonitoredTabs();
  }
}

async function updateCurrentChatScope() {
  if (!current.isChatGpt || !current.title || !current.exactRule) return;

  const button = $('toggleScope');
  button.disabled = true;
  showActionStatus('');

  try {
    const stored = await chrome.storage.local.get(['settings']);
    const settings = { ...(stored.settings || {}) };
    const patterns = Array.isArray(settings.patterns) ? [...settings.patterns] : [];
    const exactRule = current.exactRule;

    if (current.inScope && current.matchedRule === exactRule) {
      settings.patterns = patterns.filter((pattern) => normalize(pattern) !== normalize(exactRule));
      await chrome.storage.local.set({ settings });
      showActionStatus('Removed this chat from exact-title monitoring.');
    } else if (!current.inScope) {
      if (!patterns.some((pattern) => normalize(pattern) === normalize(exactRule))) {
        patterns.push(exactRule);
      }
      settings.patterns = patterns;
      settings.enabled = settings.enabled !== false;
      await chrome.storage.local.set({ settings });
      showActionStatus('Added exact rule: ' + exactRule);
    }

    await load();
  } catch (error) {
    showActionStatus('Could not update scope: ' + String(error?.message || error), true);
    renderScopeButton();
  }
}

async function runNotificationTest(type, successText) {
  showActionStatus('');
  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) throw new Error(response?.error || 'Test failed');
    showActionStatus(successText);
  } catch (error) {
    showActionStatus(String(error?.message || error), true);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function formatDiagnosticsReport(diagnostics) {
  const logs = Array.isArray(diagnostics?.logs) ? [...diagnostics.logs].reverse() : [];
  const lines = [
    'ChatGPT Notifier diagnostics',
    'Generated: ' + (diagnostics?.generatedAt || 'unknown'),
    'Extension: ' + (diagnostics?.extensionVersion || 'unknown'),
    'Release marker: ' + (diagnostics?.releaseVersion || 'unknown'),
    'Tab ID: ' + (diagnostics?.tabId ?? 'none'),
    'Tab title: ' + (diagnostics?.tab?.title || diagnostics?.contentStatus?.title || 'unknown'),
    'Tab URL: ' + (diagnostics?.tab?.url || diagnostics?.contentStatus?.url || 'unknown'),
    '',
    'Settings:',
    JSON.stringify(diagnostics?.settings || {}, null, 2),
    '',
    'Content status:',
    JSON.stringify(diagnostics?.contentStatus || null, null, 2),
    '',
    'Background runtime state:',
    JSON.stringify(diagnostics?.runtimeState || null, null, 2),
    '',
    'Event log (oldest to newest):'
  ];

  for (const entry of logs) {
    lines.push(JSON.stringify(entry));
  }

  return lines.join('\n');
}

async function copyDiagnostics() {
  showActionStatus('');
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_DIAGNOSTICS',
      tabId: current.tab?.id ?? null
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not collect diagnostics');
    const report = formatDiagnosticsReport(response.diagnostics);
    await copyText(report);
    showActionStatus('Diagnostics copied. Paste them into the chat after a missed notification.');
  } catch (error) {
    showActionStatus('Could not copy diagnostics: ' + String(error?.message || error), true);
  }
}

async function clearDiagnostics() {
  showActionStatus('');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
    if (!response?.ok) throw new Error(response?.error || 'Could not clear diagnostics');
    showActionStatus('Diagnostic event history cleared.');
  } catch (error) {
    showActionStatus('Could not clear diagnostics: ' + String(error?.message || error), true);
  }
}

$('toggleScope').addEventListener('click', () => {
  void updateCurrentChatScope();
});

$('testDesktop').addEventListener('click', () => {
  void runNotificationTest('TEST_DESKTOP', 'Windows test notification sent.');
});

$('testNtfy').addEventListener('click', () => {
  void runNotificationTest('TEST_NTFY', 'Mobile test notification sent.');
});

$('copyDiagnostics').addEventListener('click', () => {
  void copyDiagnostics();
});

$('clearDiagnostics').addEventListener('click', () => {
  void clearDiagnostics();
});

$('options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void load().finally(() => schedulePanelResize());

if (PANEL_MODE) {
  const main = document.querySelector('main');
  if (main && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => schedulePanelResize()).observe(main);
  }
  document.querySelector('details')?.addEventListener('toggle', () => schedulePanelResize());
  window.addEventListener('resize', () => schedulePanelResize());
}

setInterval(() => {
  void loadMonitoredTabs().finally(() => schedulePanelResize());
}, 2000);
