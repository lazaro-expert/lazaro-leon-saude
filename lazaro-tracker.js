/**
 * Lazaro Tracker - LL'EXPERT CRM
 * Tracking script para sites do Lazaro Leon
 *
 * Uso:
 * <script src="/lazaro-tracker.js" data-key="SUA_CHAVE" defer></script>
 */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var API_KEY = script.getAttribute('data-key');
  var ENDPOINT = 'https://boupwxtuhhdoguwoymbd.supabase.co/functions/v1/track-event';
  var STORAGE_PREFIX = 'llt_';
  var SESSION_TIMEOUT = 30 * 60 * 1000; // 30 min

  if (!API_KEY) {
    console.warn('[Lazaro Tracker] data-key nao informado');
    return;
  }

  // ─── Visitor & Session IDs ───
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + expires.toUTCString() + ';path=/;SameSite=Lax';
  }

  function getVisitorId() {
    var id = getCookie(STORAGE_PREFIX + 'vid');
    if (!id) {
      id = uuid();
      setCookie(STORAGE_PREFIX + 'vid', id, 365);
    }
    return id;
  }

  function getSessionId() {
    var sessData = sessionStorage.getItem(STORAGE_PREFIX + 'session');
    var now = Date.now();
    if (sessData) {
      try {
        var parsed = JSON.parse(sessData);
        if (now - parsed.lastActive < SESSION_TIMEOUT) {
          parsed.lastActive = now;
          sessionStorage.setItem(STORAGE_PREFIX + 'session', JSON.stringify(parsed));
          return parsed.id;
        }
      } catch (e) {}
    }
    var newId = uuid();
    sessionStorage.setItem(STORAGE_PREFIX + 'session', JSON.stringify({ id: newId, lastActive: now }));
    return newId;
  }

  // ─── UTM extraction ───
  function getUtms() {
    var params = new URLSearchParams(window.location.search);
    var utms = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (key) {
      var val = params.get(key);
      if (val) utms[key] = val;
    });

    // Persistencia: salva UTMs no storage para futuras sessoes
    if (Object.keys(utms).length > 0) {
      try {
        sessionStorage.setItem(STORAGE_PREFIX + 'utms', JSON.stringify(utms));
      } catch (e) {}
      return utms;
    }
    // Recupera UTMs salvos
    try {
      var saved = sessionStorage.getItem(STORAGE_PREFIX + 'utms');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  }

  // ─── Send event ───
  function sendEvent(eventType, extra) {
    extra = extra || {};
    var utms = getUtms();
    var payload = Object.assign({
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      event_type: eventType,
      page_url: window.location.href,
      page_title: document.title,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      screen_size: window.innerWidth + 'x' + window.innerHeight,
      language: navigator.language || 'pt-BR',
    }, utms, extra);

    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        // sendBeacon nao suporta headers customizados, entao usa fetch keepalive como fallback
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(function () {});
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
          body: JSON.stringify(payload),
        }).catch(function () {});
      }
    } catch (e) {
      console.warn('[Lazaro Tracker] erro:', e);
    }
  }

  // ─── Auto-track: pageview ───
  sendEvent('pageview');

  // ─── Auto-track: clicks (links e botoes) ───
  document.addEventListener('click', function (e) {
    var target = e.target.closest('a, button, [data-track]');
    if (!target) return;
    var label = target.getAttribute('data-track')
      || target.innerText
      || target.getAttribute('aria-label')
      || target.tagName;
    var href = target.getAttribute('href') || null;

    var meta = {
      element: target.tagName.toLowerCase(),
      text: (label || '').trim().slice(0, 100),
    };
    if (href) {
      meta.href = href;
      // Detect WhatsApp links
      if (href.indexOf('wa.me') >= 0 || href.indexOf('whatsapp.com') >= 0) {
        sendEvent('whatsapp_click', { metadata: meta });
        return;
      }
      // External links
      if (href.indexOf('http') === 0 && href.indexOf(window.location.host) < 0) {
        sendEvent('outbound_click', { metadata: meta });
        return;
      }
    }
    sendEvent('click', { metadata: meta });
  }, true);

  // ─── Auto-track: form submits ───
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var meta = {
      form_id: form.id || null,
      form_name: form.getAttribute('name') || null,
      form_action: form.getAttribute('action') || null,
    };
    sendEvent('form_submit', { metadata: meta });
  }, true);

  // ─── Auto-track: scroll depth (25, 50, 75, 100) ───
  var scrollMarks = { 25: false, 50: false, 75: false, 100: false };
  var ticking = false;
  function checkScroll() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    [25, 50, 75, 100].forEach(function (mark) {
      if (pct >= mark && !scrollMarks[mark]) {
        scrollMarks[mark] = true;
        sendEvent('scroll', { metadata: { depth: mark } });
      }
    });
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { window.requestAnimationFrame(checkScroll); ticking = true; }
  }, { passive: true });

  // ─── Auto-track: time on page (heartbeat a cada 30s, max 5min) ───
  var heartbeatCount = 0;
  var heartbeat = setInterval(function () {
    heartbeatCount++;
    if (heartbeatCount > 10) { clearInterval(heartbeat); return; }
    sendEvent('engagement', { metadata: { seconds: heartbeatCount * 30 } });
  }, 30000);

  // ─── Expose manual API: window.LL.track('evento', {dados}) ───
  window.LL = window.LL || {};
  window.LL.track = function (eventType, metadata) {
    sendEvent(eventType, { metadata: metadata || {} });
  };
})();
