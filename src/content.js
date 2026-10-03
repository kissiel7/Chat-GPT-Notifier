(() => {
  'use strict';

  const DEFAULT_STABILITY_MS = 1700;
  const POLL_MS = 500;
  const MUTATION_DEBOUNCE_MS = 120;
  const MANUAL_STOP_GRACE_MS = 3500;
  const SUBMIT_FALLBACK_STABILITY_MS = 4000;

  const STATES = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
    VERIFYING: 'verifying',
    COMPLETED: 'completed',
    MANUAL_STOP: 'manual_stop',
    ERROR: 'error'
  });

  const STOP_TEXT_TOKENS = [
    'stop generating',
    'stop streaming',
    'stop response',
    'stop',
    'antwort stoppen',
    'generierung stoppen',
    'zatrzymaj generowanie',
    'zatrzymaj odpowiedź'
  ];

  const ERROR_TEXT_TOKENS = [
    'something went wrong',
    'there was an error generating a response',
    'an error occurred',
    'network error',
    'unable to load conversation',
    'failed to get service status',
    'etwas ist schiefgelaufen',
    'netzwerkfehler',
    'wystąpił błąd',
    'błąd sieci'
  ];

  let state = STATES.IDLE;
  let cycleCounter = Date.now();
  let cycle = null;
  let lastSnapshot = null;
  let verificationTimer = null;
  let mutationTimer = null;
  let lastStatusSignature = '';
  let stabilityWindowMs = DEFAULT_STABILITY_MS;
  let manualStopUntil = 0;
  let lastEvent = 'initialized';
  let lastDelivery = 'none';

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function simpleHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function elementSignalText(element) {
    return normalize([
      element.innerText,
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.getAttribute('name')
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function scoreStopButton(element) {
    const signal = elementSignalText(element);
    const testId = normalize(element.getAttribute('data-testid')).toLowerCase();
    let score = 0;

    if (testId.includes('stop') || testId.includes('composer-stop')) score += 9;
    if (STOP_TEXT_TOKENS.some((token) => signal === token)) score += 8;
    if (STOP_TEXT_TOKENS.some((token) => signal.includes(token))) score += 5;
    if (element.closest('form')) score += 2;
    if (element.closest('main')) score += 1;

    return score;
  }

  function findStopButton(root = document) {
    // Prefer stable test-id signals when ChatGPT exposes them.
    const direct = root.querySelector(
      'button[data-testid="stop-button"], button[data-testid="composer-stop-button"], button[data-testid*="stop"], [role="button"][data-testid*="stop"]'
    );
    if (direct) return direct;

    const candidates = Array.from(root.querySelectorAll('button, [role="button"]'));
    let best = null;

    for (const element of candidates) {
      const score = scoreStopButton(element);
      if (score < 7) continue;
      if (!best || score > best.score) best = { element, score };
    }

    return best?.element || null;
  }

  function findSendButton(root = document) {
    return root.querySelector(
      '#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"], [role="button"][data-testid="send-button"]'
    );
  }

  function composerRole(root = document) {
    const control = root.querySelector('#composer-submit-button')
      || findStopButton(root)
      || findSendButton(root);
    if (!control) return 'missing';
    const testId = normalize(control.getAttribute('data-testid')).toLowerCase();
    if (testId.includes('stop')) return 'stop';
    if (testId.includes('send')) return 'send';
    const signal = elementSignalText(control);
    if (STOP_TEXT_TOKENS.some((token) => signal.includes(token))) return 'stop';
    if (/send|senden|wyslij|wyślij/i.test(signal)) return 'send';
    return testId || 'other';
  }

  function assistantCandidates(root = document) {
    const direct = Array.from(root.querySelectorAll('[data-message-author-role="assistant"]'));
    if (direct.length) return direct;

    return Array.from(root.querySelectorAll('main article')).filter((element) => {
      const text = normalize(element.innerText);
      if (text.length < 10) return false;
      if (element.closest('nav, header, footer, aside, button')) return false;
      return Boolean(element.querySelector('p, pre, code, ul, ol, table, [class*="markdown"], [class*="prose"]'));
    });
  }

  function latestAssistantTurn(root = document) {
    const candidates = assistantCandidates(root).filter((element) => normalize(element.innerText).length > 0);
    return candidates.at(-1) || null;
  }

  function assistantFingerprint(element) {
    if (!element) return null;
    const text = normalize(element.innerText || element.textContent);
    if (!text) return null;

    const head = text.slice(0, 1600);
    const tail = text.slice(-1600);
    return [
      simpleHash(`${head}|${tail}`),
      text.length,
      element.querySelectorAll('pre, code').length,
      element.querySelectorAll('table').length,
      element.querySelectorAll('img').length
    ].join(':');
  }

  function detectError(root = document) {
    const alerts = Array.from(root.querySelectorAll('[role="alert"], [data-testid*="error"], .text-red-500, .text-danger'));
    const alertText = normalize(alerts.map((element) => element.innerText).join(' ')).toLowerCase();
    if (ERROR_TEXT_TOKENS.some((token) => alertText.includes(token))) return true;

    const tail = normalize(document.body?.innerText).slice(-2500).toLowerCase();
    return ERROR_TEXT_TOKENS.some((token) => tail.includes(token));
  }

  function sanitizeDocumentTitle(value) {
    let title = normalize(value);
    title = title.replace(/^chatgpt\s*[|—–-]\s*/i, '');
    title = title.replace(/\s*[|—–-]\s*chatgpt$/i, '');
    return normalize(title);
  }

  function titleFromCurrentConversationLink() {
    const currentPath = location.pathname;
    const links = Array.from(document.querySelectorAll('a[href*="/c/"]'));

    for (const link of links) {
      try {
        const url = new URL(link.href, location.origin);
        if (url.pathname !== currentPath) continue;
        const text = normalize(link.innerText || link.textContent);
        if (text && text.toLowerCase() !== 'chatgpt') return text;
      } catch (_) {
        // Ignore malformed links.
      }
    }
    return '';
  }

  function getConversationTitle() {
    const documentTitle = sanitizeDocumentTitle(document.title);
    if (documentTitle && documentTitle.toLowerCase() !== 'chatgpt') return documentTitle;
    return titleFromCurrentConversationLink() || 'ChatGPT';
  }

  function inspect() {
    const stopButton = findStopButton();
    const assistant = latestAssistantTurn();
    return {
      at: Date.now(),
      stopPresent: Boolean(stopButton),
      sendPresent: Boolean(findSendButton()),
      composerRole: composerRole(),
      assistantFingerprint: assistantFingerprint(assistant),
      assistantPresent: Boolean(assistant),
      errorPresent: detectError(),
      title: getConversationTitle(),
      url: location.href
    };
  }

  function safeSend(message) {
    try {
      if (!chrome.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function setState(nextState, reason) {
    state = nextState;
    lastEvent = reason;
    emitStatus(reason);
  }

  function emitStatus(reason = 'state') {
    const snapshot = inspect();
    const payload = {
      type: 'STATUS_UPDATE',
      state,
      reason,
      cycleId: cycle?.id || null,
      title: snapshot.title,
      url: snapshot.url,
      stopPresent: snapshot.stopPresent,
      sendPresent: snapshot.sendPresent,
      composerRole: snapshot.composerRole,
      assistantPresent: snapshot.assistantPresent,
      lastDelivery,
      timestamp: Date.now()
    };
    const signature = JSON.stringify([payload.state, payload.reason, payload.cycleId, payload.title, payload.url]);
    if (signature === lastStatusSignature) return;
    lastStatusSignature = signature;
    void safeSend(payload);
  }

  function cancelVerification() {
    if (verificationTimer) {
      clearTimeout(verificationTimer);
      verificationTimer = null;
    }
  }

  function beginCycle(snapshot, source = 'stop-control') {
    cycleCounter += 1;
    cycle = {
      id: cycleCounter,
      startedAt: Date.now(),
      source,
      stopSeen: snapshot.stopPresent,
      initialFingerprint: snapshot.assistantFingerprint,
      lastFingerprint: snapshot.assistantFingerprint,
      sawAssistantActivity: false,
      manualStop: false
    };
    lastDelivery = 'pending';
    cancelVerification();
    setState(STATES.ACTIVE, `generation-started:${source}`);
  }

  function endCycleWithoutNotification(nextState, reason) {
    cancelVerification();
    cycle = null;
    setState(nextState, reason);
    setTimeout(() => {
      if (!cycle) setState(STATES.IDLE, `${reason}-settled`);
    }, 1200);
  }

  function scheduleVerification(expectedFingerprint) {
    if (!cycle) return;
    cancelVerification();
    const verifyingCycleId = cycle.id;
    setState(STATES.VERIFYING, 'completion-candidate');

    verificationTimer = setTimeout(() => {
      verificationTimer = null;
      const snapshot = inspect();
      if (!cycle || cycle.id !== verifyingCycleId) return;

      if (snapshot.errorPresent) {
        endCycleWithoutNotification(STATES.ERROR, 'error-detected');
        return;
      }

      if (cycle.manualStop || Date.now() < manualStopUntil) {
        endCycleWithoutNotification(STATES.MANUAL_STOP, 'manual-stop');
        return;
      }

      if (snapshot.stopPresent) {
        setState(STATES.ACTIVE, 'generation-resumed');
        return;
      }

      if (snapshot.assistantFingerprint !== expectedFingerprint) {
        cycle.sawAssistantActivity = true;
        cycle.lastFingerprint = snapshot.assistantFingerprint;
        scheduleVerification(snapshot.assistantFingerprint);
        return;
      }

      // A complete observed Stop-button lifecycle is sufficient evidence that ChatGPT
      // was generating. Assistant-turn markup changes frequently, so assistant activity
      // is treated as supporting evidence rather than a hard completion requirement.
      // Manual Stop and obvious errors are still suppressed above.
      const completedCycle = cycle;
      cycle = null;
      setState(STATES.COMPLETED, 'generation-completed');
      void safeSend({
        type: 'GENERATION_COMPLETE',
        cycleId: completedCycle.id,
        title: snapshot.title,
        url: snapshot.url,
        durationMs: Date.now() - completedCycle.startedAt,
        timestamp: Date.now()
      }).then((result) => {
        if (!result) {
          lastDelivery = 'no-background-response';
        } else if (result.ok === false) {
          lastDelivery = `error:${result.error || result.reason || 'unknown'}`;
        } else if (result.inScope === false) {
          lastDelivery = 'out-of-scope';
        } else if (result.duplicate) {
          lastDelivery = 'duplicate-suppressed';
        } else {
          lastDelivery = result.results?.desktop || 'acknowledged';
        }
        emitStatus(`delivery:${lastDelivery}`);
      });

      setTimeout(() => {
        if (!cycle) setState(STATES.IDLE, 'completion-settled');
      }, 1800);
    }, cycle?.stopSeen ? stabilityWindowMs : SUBMIT_FALLBACK_STABILITY_MS);
  }

  function evaluate() {
    const snapshot = inspect();

    if (!lastSnapshot) {
      lastSnapshot = snapshot;
      emitStatus('initialized');
      return;
    }

    if (!cycle) {
      if (!lastSnapshot.stopPresent && snapshot.stopPresent) {
        beginCycle(snapshot);
      }
      lastSnapshot = snapshot;
      return;
    }

    if (snapshot.errorPresent) {
      endCycleWithoutNotification(STATES.ERROR, 'error-detected');
      lastSnapshot = snapshot;
      return;
    }

    if (snapshot.assistantFingerprint !== cycle.lastFingerprint) {
      if (snapshot.assistantFingerprint !== cycle.initialFingerprint) {
        cycle.sawAssistantActivity = true;
      }
      cycle.lastFingerprint = snapshot.assistantFingerprint;
      if (state === STATES.VERIFYING && !snapshot.stopPresent) {
        scheduleVerification(snapshot.assistantFingerprint);
      }
    }

    if (snapshot.stopPresent) {
      cycle.stopSeen = true;
      cancelVerification();
      if (state !== STATES.ACTIVE) setState(STATES.ACTIVE, 'generation-active');
    } else if (lastSnapshot.stopPresent || state === STATES.ACTIVE) {
      if (cycle.manualStop || Date.now() < manualStopUntil) {
        endCycleWithoutNotification(STATES.MANUAL_STOP, 'manual-stop');
      } else if (cycle.stopSeen || cycle.sawAssistantActivity) {
        scheduleVerification(snapshot.assistantFingerprint);
      }
    }

    lastSnapshot = snapshot;
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button, [role="button"]') : null;
    if (!target) return;

    const testId = normalize(target.getAttribute('data-testid')).toLowerCase();
    const isStop = testId.includes('stop') || scoreStopButton(target) >= 7;
    const isSend = testId === 'send-button' || target.id === 'composer-submit-button' && testId.includes('send');

    if (isStop) {
      manualStopUntil = Date.now() + MANUAL_STOP_GRACE_MS;
      if (cycle) cycle.manualStop = true;
      lastEvent = 'stop-button-clicked';
      emitStatus(lastEvent);
      return;
    }

    if (isSend && !cycle) {
      const snapshot = inspect();
      beginCycle(snapshot, 'send-click');
    }
  }, true);

  document.addEventListener('submit', () => {
    if (!cycle) {
      const snapshot = inspect();
      beginCycle(snapshot, 'form-submit');
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(evaluate, MUTATION_DEBOUNCE_MS);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'data-testid', 'title']
  });

  setInterval(evaluate, POLL_MS);

  chrome.storage.local.get(['settings']).then(({ settings }) => {
    const configured = Number(settings?.stabilityWindowMs);
    if (Number.isFinite(configured) && configured >= 800 && configured <= 10000) {
      stabilityWindowMs = configured;
    }
  }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings?.newValue) return;
    const configured = Number(changes.settings.newValue.stabilityWindowMs);
    if (Number.isFinite(configured) && configured >= 800 && configured <= 10000) {
      stabilityWindowMs = configured;
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_CONTENT_STATUS') {
      const snapshot = inspect();
      sendResponse({
        state,
        cycleId: cycle?.id || null,
        title: snapshot.title,
        url: snapshot.url,
        stopPresent: snapshot.stopPresent,
        sendPresent: snapshot.sendPresent,
        composerRole: snapshot.composerRole,
        assistantPresent: snapshot.assistantPresent,
        lastEvent,
        lastDelivery,
        cycleSource: cycle?.source || null,
        stopSeen: Boolean(cycle?.stopSeen)
      });
    }
  });

  evaluate();
})();
