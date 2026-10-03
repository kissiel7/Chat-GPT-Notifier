'use strict';

const DEFAULT_SETTINGS = {
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
};

const $ = (id) => document.getElementById(id);

function showStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').style.color = isError ? '#a12929' : '';
  setTimeout(() => {
    if ($('status').textContent === text) $('status').textContent = '';
  }, 4000);
}

async function load() {
  const result = await chrome.storage.local.get(['settings']);
  const settings = { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
  $('enabled').checked = settings.enabled;
  $('patterns').value = (settings.patterns || []).join('\n');
  $('desktopEnabled').checked = settings.desktopEnabled;
  $('notifyWhenActive').checked = settings.notifyWhenActive;
  $('ntfyEnabled').checked = settings.ntfyEnabled;
  $('ntfyTopic').value = settings.ntfyTopic || '';
  $('ntfyToken').value = settings.ntfyToken || '';
  $('ntfyIncludeChatLink').checked = settings.ntfyIncludeChatLink;
  $('stabilityWindowMs').value = settings.stabilityWindowMs;
}

function collect() {
  const stabilityWindowMs = Math.max(800, Math.min(10000, Number($('stabilityWindowMs').value) || 1700));
  return {
    enabled: $('enabled').checked,
    patterns: $('patterns').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    desktopEnabled: $('desktopEnabled').checked,
    notifyWhenActive: $('notifyWhenActive').checked,
    ntfyEnabled: $('ntfyEnabled').checked,
    ntfyTopic: $('ntfyTopic').value.trim(),
    ntfyToken: $('ntfyToken').value.trim(),
    ntfyIncludeChatLink: $('ntfyIncludeChatLink').checked,
    stabilityWindowMs
  };
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ settings: collect() });
  showStatus('Saved.');
});

$('testDesktop').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'TEST_DESKTOP' });
    if (!response?.ok) throw new Error(response?.error || 'Test failed');
    showStatus('Windows test sent.');
  } catch (error) {
    showStatus(String(error?.message || error), true);
  }
});

$('testNtfy').addEventListener('click', async () => {
  try {
    await chrome.storage.local.set({ settings: collect() });
    const response = await chrome.runtime.sendMessage({ type: 'TEST_NTFY' });
    if (!response?.ok) throw new Error(response?.error || 'Test failed');
    showStatus('ntfy test sent.');
  } catch (error) {
    showStatus(String(error?.message || error), true);
  }
});

void load();
