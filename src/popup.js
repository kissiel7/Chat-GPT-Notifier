'use strict';

const $ = (id) => document.getElementById(id);

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//i.test(tab.url || '')) {
    $('title').textContent = 'Not a ChatGPT tab';
    $('scope').textContent = 'No';
    $('state').textContent = '—';
    $('event').textContent = '—';
    return;
  }

  let contentStatus = null;
  try {
    contentStatus = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT_STATUS' });
  } catch (_) {
    // The content script can be unavailable briefly after extension reload.
  }

  const status = await chrome.runtime.sendMessage({
    type: 'GET_TAB_STATUS',
    tabId: tab.id,
    title: contentStatus?.title || tab.title,
    url: tab.url
  });

  $('title').textContent = status.title || contentStatus?.title || tab.title || 'ChatGPT';
  $('scope').textContent = status.inScope ? 'Yes' : 'No';
  $('scope').className = status.inScope ? 'good' : 'bad';
  $('state').textContent = contentStatus?.state || status.state || 'idle';
  $('event').textContent = status.lastEvent || '—';
  $('desktop').textContent = status.settings?.desktopEnabled ? 'On' : 'Off';
  $('ntfy').textContent = status.settings?.ntfyEnabled ? 'On' : 'Off';
}

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
void load();
