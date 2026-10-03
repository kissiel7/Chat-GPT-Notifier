'use strict';

const $ = (id) => document.getElementById(id);

let current = {
  tab: null,
  title: '',
  inScope: false,
  matchedRule: null,
  exactRule: null,
  isChatGpt: false
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
      isChatGpt
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
      renderScopeButton();
      return;
    }

    const contentStatus = await getContentStatus(tab.id);
    const status = await getBackgroundStatus(tab, contentStatus);

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
    $('desktop').textContent = status?.settings?.desktopEnabled === false ? 'Off' : 'On';
    $('ntfy').textContent = status?.settings?.ntfyEnabled ? 'On' : 'Off';

    renderScopeButton();

    if (!contentStatus) {
      showActionStatus('Chat detector is not available yet. Refresh the ChatGPT tab after reloading the extension.');
    }
  } catch (error) {
    showActionStatus('Popup error: ' + String(error?.message || error), true);
    $('toggleScope').disabled = true;
    $('toggleScope').textContent = 'Popup unavailable';
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

$('toggleScope').addEventListener('click', () => {
  void updateCurrentChatScope();
});

$('options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void load();
