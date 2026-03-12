(function () {
  function ensurePixelFont() {
    if (document.getElementById('mode-nav-pixel-font')) {
      return;
    }

    const fontLink = document.createElement('link');
    fontLink.id = 'mode-nav-pixel-font';
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
    document.head.append(fontLink);
  }

  function injectStyles() {
    if (document.getElementById('mode-nav-style')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'mode-nav-style';
    style.textContent = `
      .site-home-logo {
        position: fixed;
        top: 12px;
        left: 12px;
        z-index: 999;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 12px 8px;
        border: 2px solid var(--line, rgba(255,255,255,0.16));
        background: rgba(8, 8, 8, 0.9);
        color: var(--text, #ffffff);
        text-decoration: none;
        text-transform: uppercase;
        letter-spacing: 0.08rem;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        backdrop-filter: blur(6px);
      }

      .site-home-logo.is-home {
        border-color: #ff8a1e;
        box-shadow:
          0 8px 24px rgba(0, 0, 0, 0.28),
          0 0 22px rgba(255, 138, 30, 0.18);
      }

      .site-home-logo span {
        font-family: "Press Start 2P", "VT323", "Courier New", monospace;
        font-size: 0.72rem;
        line-height: 1.2;
      }

    `;
    document.head.append(style);
  }

  function normalizePrimaryLinks(nav) {
    Array.from(nav.querySelectorAll('a.mode-tab')).forEach((link) => {
      const href = link.getAttribute('href');
      const label = (link.textContent || '').trim().toUpperCase();

      if (href === './index.html' && label === 'CRT VIDEO') {
        link.href = './crtvideo.html';
      }
    });
  }

  function moveDatamoshVideoFirst(nav) {
    const datamoshVideoLink = Array.from(nav.querySelectorAll('a.mode-tab')).find(
      (link) => link.getAttribute('href') === './datamosh-video.html'
    );

    if (!datamoshVideoLink) {
      return;
    }

    nav.insertBefore(datamoshVideoLink, nav.firstChild);
  }

  function ensureHomeLogo() {
    if (document.querySelector('.site-home-logo')) {
      return;
    }

    const logo = document.createElement('a');
    logo.className = 'site-home-logo';
    logo.href = './index.html';
    logo.setAttribute('aria-label', 'Datamosh Video home');
    logo.innerHTML = '<span>DATAMOSH<br>VIDEO</span>';
    if (window.location.pathname.endsWith('/datamosh-video.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/index.html')) {
      logo.classList.add('is-home');
    }
    document.body.append(logo);
  }

  function enhanceNav(nav) {
    if (!nav || nav.dataset.dropdownReady === 'true') {
      return;
    }

    normalizePrimaryLinks(nav);
    moveDatamoshVideoFirst(nav);

    nav.dataset.dropdownReady = 'true';
  }

  ensurePixelFont();
  injectStyles();
  document.querySelectorAll('nav.mode-tabs').forEach(enhanceNav);
  ensureHomeLogo();
})();
