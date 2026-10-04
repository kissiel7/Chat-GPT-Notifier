'use strict';

const $ = (id) => document.getElementById(id);

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
}

function monitoredStateLabel(tab) {
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
    return;
  }

  for (const tab of tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-tab' + (tab.tabId === current.tab?.id ? ' current' : '');
    button.title = 'Switch to ' + tab.title;

    const indicator = document.createElement('span');
    indicator.className = 'chat-indicator' + (tab.running ? ' running' : '');
    indicator.textContent = tab.running ? '●' : (tab.state === 'completed' ? '✓' : '○');

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
        window.close();
      } catch (error) {
        showActionStatus(String(error?.message || error), true);
      }
    });

    list.appendChild(button);
  }
}

async function loadMonitoredTabs() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MONITORED_TABS' });
    if (!response?.ok) throw new Error(response?.error || 'Could not load monitored tabs');
    renderMonitoredTabs(response);
  } catch (error) {
    $('runningSummary').textContent = 'unavailable';
    const list = $('monitoredTabs');
    list.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Dashboard unavailable: ' + String(error?.message || error);
    list.appendChild(empty);
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

async function getContentStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTENT_STATUS' });
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

async function load() {
  await renderDeploymentState();

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0] || null;
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
      $('testDesktop').disabled = false;
      $('testNtfy').disabled = true;
      renderScopeButton();
      await loadMonitoredTabs();
      return;
    }

    const contentStatus = await getContentStatus(tab.id);
    const status = await getBackgroundStatus(tab, contentStatus);
    current.status = status;

    const title = normalize(status?.title || contentStatus?.title || tab.title || 'ChatGPT');
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
    await loadMonitoredTabs();

    if (!contentStatus) {
      showActionStatus('Chat detector is not available yet. Refresh the ChatGPT tab after reloading the extension.');
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

$('toggleScope').addEventListener('click', () => {
  void updateCurrentChatScope();
});

$('testDesktop').addEventListener('click', () => {
  void runNotificationTest('TEST_DESKTOP', 'Windows test notification sent.');
});

$('testNtfy').addEventListener('click', () => {
  void runNotificationTest('TEST_NTFY', 'Mobile test notification sent.');
});

$('options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void load();
setInterval(() => {
  void loadMonitoredTabs();
}, 1200);
