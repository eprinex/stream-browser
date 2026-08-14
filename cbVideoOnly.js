/** Chaturbate oda sayfasında yalnızca video — chat/header/sidebar gizle */

function isCbRoomUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'chaturbate.com') return false;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return false;
    const blocked = new Set([
      'tag',
      'tags',
      'accounts',
      'auth',
      'discover',
      'followed',
      'tipping',
      'affiliates',
      'apps',
      'sitemap',
      'security',
      'privacy',
      'terms',
      'law_enforcement',
      '2257',
      'billingsupport',
      'tipping',
      'contest',
      'exhibitions',
      'external_link',
    ]);
    return !blocked.has(parts[0].toLowerCase());
  } catch (_) {
    return false;
  }
}

/**
 * CSS ile #main gizlenince video da ölüyordu (parent display:none).
 * Bunun yerine videoyu bulup sabit katmana taşıyoruz.
 */
function getCbVideoOnlyScript() {
  return `(() => {
    const STYLE_ID = 'sb-cb-video-only';
    const LAYER_ID = 'sb-cb-video-layer';

    if (window.__sbCbVideoOnlyActive) {
      try { window.__sbCbVideoOnlyApply && window.__sbCbVideoOnlyApply(); } catch (e) {}
      return;
    }
    window.__sbCbVideoOnlyActive = true;

    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = \`
      html.sb-cb-theater, html.sb-cb-theater body {
        background: #000 !important;
        overflow: hidden !important;
        margin: 0 !important;
        height: 100% !important;
      }
      html.sb-cb-theater body > *:not(#\${LAYER_ID}) {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      #\${LAYER_ID} {
        display: flex !important;
        visibility: visible !important;
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        z-index: 2147483647 !important;
        background: #000 !important;
        align-items: center !important;
        justify-content: center !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }
      #\${LAYER_ID} video,
      #\${LAYER_ID} .vjs-tech,
      #\${LAYER_ID} canvas {
        display: block !important;
        visibility: visible !important;
        width: 100% !important;
        height: 100% !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        object-fit: contain !important;
        background: #000 !important;
      }
      #\${LAYER_ID} .vjs-control-bar,
      #\${LAYER_ID} .vjs-big-play-button,
      #\${LAYER_ID} button,
      #\${LAYER_ID} [class*="control"],
      #\${LAYER_ID} [class*="overlay"]:not([class*="video"]) {
        /* kontrolleri bırak — bazı yayınlarda lazım; istemezsek gizlenebilir */
      }
    \`;
    (document.head || document.documentElement).appendChild(css);
    document.documentElement.classList.add('sb-cb-theater');

    function findVideo() {
      const vids = Array.from(document.querySelectorAll('video'));
      if (!vids.length) return null;
      // En büyük / oynayan videoyu seç
      vids.sort((a, b) => {
        const as = (a.videoWidth || a.clientWidth || 0) * (a.videoHeight || a.clientHeight || 0);
        const bs = (b.videoWidth || b.clientWidth || 0) * (b.videoHeight || b.clientHeight || 0);
        const ap = a.paused ? 0 : 1;
        const bp = b.paused ? 0 : 1;
        return bp - ap || bs - as;
      });
      return vids[0];
    }

    function ensureLayer() {
      let layer = document.getElementById(LAYER_ID);
      if (!layer) {
        layer = document.createElement('div');
        layer.id = LAYER_ID;
        document.body.appendChild(layer);
      }
      return layer;
    }

    function pickHost(video) {
      // video.js / CB player: video'nun yakın konteyneri
      let el = video;
      for (let i = 0; i < 6 && el.parentElement; i++) {
        const p = el.parentElement;
        if (p === document.body || p === document.documentElement) break;
        const cls = (p.className && String(p.className)) || '';
        const id = p.id || '';
        if (
          /player|video|vjs|hls|jwplayer|xmovie/i.test(cls + ' ' + id) ||
          p.getAttribute('data-testid')?.toLowerCase?.().includes('player')
        ) {
          el = p;
          continue;
        }
        // Boyutu video'ya yakın bir sarmalayıcı bulunca dur
        if (p.clientWidth >= (video.clientWidth || 0) * 0.9 && p.clientHeight >= (video.clientHeight || 0) * 0.9) {
          el = p;
        }
        break;
      }
      // En azından video'nun doğrudan parent'ı
      return video.parentElement && video.parentElement !== document.body
        ? (el.contains(video) ? el : video.parentElement)
        : video;
    }

    function apply() {
      if (!document.body) return;
      document.documentElement.classList.add('sb-cb-theater');
      const video = findVideo();
      const layer = ensureLayer();
      if (!video) return;

      const host = pickHost(video);
      if (!layer.contains(host) && !layer.contains(video)) {
        // Orijinal yeri işaretle (kapatınca geri koyabilmek için)
        if (!host.__sbOrigParent) {
          host.__sbOrigParent = host.parentElement;
          host.__sbOrigNext = host.nextSibling;
        }
        layer.innerHTML = '';
        layer.appendChild(host);
      }

      try {
        video.controls = false;
        video.playsInline = true;
        video.muted = false;
        if (video.paused) video.play().catch(() => {});
      } catch (e) {}

      // Katmanı her zaman body sonunda tut
      if (layer.parentElement !== document.body) document.body.appendChild(layer);
      else if (layer.nextSibling) document.body.appendChild(layer);
    }

    window.__sbCbVideoOnlyApply = apply;

    window.__sbCbVideoOnlyDisable = () => {
      const layer = document.getElementById(LAYER_ID);
      if (layer) {
        Array.from(layer.children).forEach((child) => {
          const parent = child.__sbOrigParent;
          const next = child.__sbOrigNext;
          if (parent && parent.isConnected) {
            try {
              parent.insertBefore(child, next && next.parentElement === parent ? next : null);
            } catch (e) {
              parent.appendChild(child);
            }
          }
          delete child.__sbOrigParent;
          delete child.__sbOrigNext;
        });
        layer.remove();
      }
      document.getElementById(STYLE_ID)?.remove();
      document.documentElement.classList.remove('sb-cb-theater');
      window.__sbCbVideoOnlyActive = false;
      if (window.__sbCbVideoOnlyTimer) {
        clearInterval(window.__sbCbVideoOnlyTimer);
        window.__sbCbVideoOnlyTimer = null;
      }
      if (window.__sbCbVideoOnlyObs) {
        try { window.__sbCbVideoOnlyObs.disconnect(); } catch (e) {}
        window.__sbCbVideoOnlyObs = null;
      }
    };

    apply();
    window.__sbCbVideoOnlyTimer = setInterval(apply, 1500);

    try {
      const obs = new MutationObserver(() => {
        if (!document.getElementById(LAYER_ID)?.querySelector('video')) apply();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      window.__sbCbVideoOnlyObs = obs;
    } catch (e) {}
  })();`;
}

function getCbVideoOnlyDisableScript() {
  return `(() => {
    if (window.__sbCbVideoOnlyDisable) {
      window.__sbCbVideoOnlyDisable();
      return;
    }
    document.getElementById('sb-cb-video-only')?.remove();
    document.getElementById('sb-cb-video-layer')?.remove();
    document.documentElement.classList.remove('sb-cb-theater');
    window.__sbCbVideoOnly = false;
    window.__sbCbVideoOnlyActive = false;
  })();`;
}

module.exports = {
  getCbVideoOnlyScript,
  getCbVideoOnlyDisableScript,
  isCbRoomUrl,
};
