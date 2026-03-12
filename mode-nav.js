(function () {
  const GROUP_HREFS = [
    './datamosh.html',
    './datamosh-v2.html',
    './datamosh-v3.html',
    './datamosh-v4.html',
    './datamosh-v5.html',
    './datamosh-v6.html',
  ];

  const EXTRA_LINKS = [
    { href: './datamosh-v7.html', label: 'Datamosh V7' },
    { href: './datamosh-v8.html', label: 'Datamosh V8' },
  ];

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

      .mode-dropdown {
        position: relative;
        display: inline-block;
      }

      .mode-dropdown summary {
        list-style: none;
        cursor: pointer;
      }

      .mode-dropdown summary::-webkit-details-marker {
        display: none;
      }

      .mode-dropdown-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        min-width: 190px;
        display: none;
        padding: 8px;
        border: 1px solid var(--line, rgba(255,255,255,0.16));
        background: var(--panel, #111111);
        box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
        z-index: 50;
      }

      .mode-dropdown[open] .mode-dropdown-menu {
        display: grid;
        gap: 6px;
      }

      .mode-dropdown-link {
        display: block;
        padding: 8px 10px;
        border: 1px solid transparent;
        color: inherit;
        text-decoration: none;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.08rem;
        white-space: nowrap;
      }

      .mode-dropdown-link.active {
        border-color: var(--line, rgba(255,255,255,0.16));
      }
    `;
    document.head.append(style);
  }

  function closeAllDropdowns(except) {
    document.querySelectorAll('.mode-dropdown[open]').forEach((dropdown) => {
      if (dropdown !== except) {
        dropdown.removeAttribute('open');
      }
    });
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

  function ensureExtraLinks(nav) {
    EXTRA_LINKS.forEach(({ href, label }) => {
      const exists = Array.from(nav.querySelectorAll('a.mode-tab')).some((link) => link.getAttribute('href') === href);
      if (exists) {
        return;
      }

      const anchor = document.createElement('a');
      const template = nav.querySelector('a.mode-tab') || nav.querySelector('summary.mode-tab');
      anchor.className = template ? template.className.replace(/\bactive\b/g, '').trim() : 'mode-tab';
      anchor.href = href;
      anchor.textContent = label;
      if (window.location.pathname.endsWith(href.replace('./', '/'))) {
        anchor.classList.add('active');
      }
      nav.append(anchor);
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

  function buildDropdown(nav) {
    const links = Array.from(nav.querySelectorAll('a.mode-tab'));
    const groupedLinks = GROUP_HREFS.map((href) => links.find((link) => link.getAttribute('href') === href)).filter(Boolean);

    if (!groupedLinks.length || nav.querySelector('.mode-dropdown')) {
      return;
    }

    const firstLink = groupedLinks[0];
    const dropdown = document.createElement('details');
    dropdown.className = 'mode-dropdown';

    const summary = document.createElement('summary');
    summary.className = firstLink.className;
    summary.textContent = 'Datamosh V1-V6';
    if (groupedLinks.some((link) => link.classList.contains('active'))) {
      summary.classList.add('active');
      dropdown.classList.add('active');
    }

    const menu = document.createElement('div');
    menu.className = 'mode-dropdown-menu';
    nav.insertBefore(dropdown, firstLink);
    groupedLinks.forEach((link) => {
      const item = document.createElement('a');
      item.href = link.getAttribute('href');
      item.textContent = link.textContent;
      item.className = 'mode-dropdown-link';
      if (link.classList.contains('active')) {
        item.classList.add('active');
      }
      menu.append(item);
      link.remove();
    });

    dropdown.append(summary, menu);

    summary.addEventListener('click', () => {
      window.setTimeout(() => closeAllDropdowns(dropdown), 0);
    });
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
    ensureExtraLinks(nav);
    buildDropdown(nav);
    moveDatamoshVideoFirst(nav);

    nav.dataset.dropdownReady = 'true';
  }

  ensurePixelFont();
  injectStyles();
  document.querySelectorAll('nav.mode-tabs').forEach(enhanceNav);
  ensureHomeLogo();

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.mode-dropdown')) {
      closeAllDropdowns(null);
    }
  });
})();
