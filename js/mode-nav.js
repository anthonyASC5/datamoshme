(function () {
  const HOME_HREF = "../index.html";
  const TAB_CONFIG = [
    { href: HOME_HREF, label: "Datamosh", group: "home", aliases: ["./index.html", "./", "./datamosh.html"] },
    { href: "./crtvideo.html", label: "CRT Video", group: "vfx98" },
    { href: "./motionvideo.html", label: "Motion Video", group: "vfx98" },
    { href: "./crtimage.html", label: "CRT Image", group: "vfx98" },
  ];

  function ensurePixelFont() {
    if (document.getElementById("mode-nav-pixel-font")) {
      return;
    }

    const fontLink = document.createElement("link");
    fontLink.id = "mode-nav-pixel-font";
    fontLink.rel = "stylesheet";
    fontLink.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap";
    document.head.append(fontLink);
  }

  function injectStyles() {
    if (document.getElementById("mode-nav-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "mode-nav-style";
    style.textContent = `
      .mode-tabs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }

      .mode-tab,
      .mode-tab-group {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 24px;
        padding: 3px 9px;
        border-radius: 0;
        color: #000000;
        font-family: "Tahoma", "MS Sans Serif", "Segoe UI", sans-serif;
        font-size: 12px;
        letter-spacing: 0;
        line-height: 1.2;
        text-decoration: none;
        text-transform: none;
        white-space: nowrap;
      }

      .mode-tab {
        border: 1px solid;
        border-color: #ffffff #404040 #404040 #ffffff;
        background: #c0c0c0;
        box-shadow: inset 1px 1px 0 #dfdfdf, inset -1px -1px 0 #808080;
      }

      .mode-tab:hover,
      .mode-tab:focus-visible,
      .mode-tab.active {
        border-color: #404040 #ffffff #ffffff #404040;
        background: #d4d0c8;
        color: #000000;
        box-shadow: inset 1px 1px 0 #808080, inset -1px -1px 0 #dfdfdf;
        outline: 1px dotted #000000;
        outline-offset: -4px;
      }

      .mode-tab-group {
        min-width: 58px;
        margin-left: 4px;
        border: 1px solid;
        border-color: #808080 #ffffff #ffffff #808080;
        background: #d4d0c8;
        font-weight: 700;
        box-shadow: inset 1px 1px 0 #808080, inset -1px -1px 0 #ffffff;
      }

      .site-home-logo {
        --monster-size: 4px;
        --monster-shadow:
          3em 0em #690000, 4em 0em #690000, 5em 0em #690000, 6em 0em #690000,
          2em 1em #690000, 3em 1em #9b0000, 4em 1em #9b0000, 5em 1em #9b0000, 6em 1em #9b0000, 7em 1em #690000,
          1em 2em #690000, 2em 2em #9b0000, 3em 2em #ffffff, 4em 2em #ffffff, 5em 2em #ffffff, 6em 2em #ffffff, 7em 2em #9b0000, 8em 2em #690000,
          1em 3em #690000, 2em 3em #9b0000, 3em 3em #ffffff, 4em 3em #202020, 5em 3em #202020, 6em 3em #ffffff, 7em 3em #9b0000, 8em 3em #690000,
          1em 4em #690000, 2em 4em #9b0000, 3em 4em #ffffff, 4em 4em #202020, 5em 4em #202020, 6em 4em #202020, 7em 4em #9b0000, 8em 4em #690000,
          2em 5em #690000, 3em 5em #9b0000, 4em 5em #9b0000, 5em 5em #9b0000, 6em 5em #9b0000, 7em 5em #690000,
          1em 6em #9b0000, 2em 6em #9b0000, 3em 6em #202020, 4em 6em #202020, 5em 6em #202020, 6em 6em #202020, 7em 6em #9b0000, 8em 6em #9b0000,
          1em 7em #9b0000, 2em 7em #202020, 3em 7em #ffffff, 4em 7em #202020, 5em 7em #ffffff, 6em 7em #202020, 7em 7em #202020, 8em 7em #9b0000,
          1em 8em #9b0000, 2em 8em #9b0000, 3em 8em #9b0000, 4em 8em #9b0000, 5em 8em #9b0000, 6em 8em #9b0000, 7em 8em #9b0000, 8em 8em #9b0000;
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 999;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 62px;
        height: 58px;
        padding: 8px;
        border: 2px solid #270000;
        border-radius: 0;
        background: #1a0000;
        color: #ffffff;
        text-decoration: none;
        text-transform: uppercase;
        box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.38), inset 1px 1px 0 #9b0000;
        transition:
          transform 120ms steps(2),
          box-shadow 120ms steps(2);
      }

      .site-home-logo:hover,
      .site-home-logo:focus-visible {
        --monster-shadow:
          3em 0em #690000, 4em 0em #690000, 5em 0em #690000, 6em 0em #690000,
          2em 1em #690000, 3em 1em #9b0000, 4em 1em #9b0000, 5em 1em #9b0000, 6em 1em #9b0000, 7em 1em #690000,
          1em 2em #690000, 2em 2em #9b0000, 3em 2em #ffffff, 4em 2em #ffffff, 5em 2em #ffffff, 6em 2em #ffffff, 7em 2em #9b0000, 8em 2em #690000,
          1em 3em #690000, 2em 3em #9b0000, 3em 3em #ffffff, 4em 3em #202020, 5em 3em #202020, 6em 3em #ffffff, 7em 3em #9b0000, 8em 3em #690000,
          1em 4em #690000, 2em 4em #9b0000, 3em 4em #ffffff, 4em 4em #202020, 5em 4em #202020, 6em 4em #202020, 7em 4em #9b0000, 8em 4em #690000,
          2em 5em #690000, 3em 5em #9b0000, 4em 5em #9b0000, 5em 5em #9b0000, 6em 5em #9b0000, 7em 5em #690000,
          1em 6em #9b0000, 2em 6em #9b0000, 3em 6em #202020, 4em 6em #202020, 5em 6em #202020, 6em 6em #202020, 7em 6em #9b0000, 8em 6em #9b0000,
          1em 7em #9b0000, 2em 7em #202020, 3em 7em #202020, 4em 7em #202020, 5em 7em #202020, 6em 7em #202020, 7em 7em #202020, 8em 7em #9b0000,
          1em 8em #9b0000, 2em 8em #202020, 3em 8em #ffffff, 4em 8em #202020, 5em 8em #ffffff, 6em 8em #202020, 7em 8em #202020, 8em 8em #9b0000,
          1em 9em #9b0000, 2em 9em #9b0000, 3em 9em #9b0000, 4em 9em #9b0000, 5em 9em #9b0000, 6em 9em #9b0000, 7em 9em #9b0000, 8em 9em #9b0000;
        transform: translate(-1px, -1px);
        box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.42), inset 1px 1px 0 #c40000;
      }

      .site-home-logo:focus-visible {
        outline: 1px dotted #ffffff;
        outline-offset: -5px;
      }

      .site-home-monster {
        position: relative;
        width: 40px;
        height: 40px;
        font-size: var(--monster-size);
        image-rendering: pixelated;
      }

      .site-home-monster::before {
        content: "";
        position: absolute;
        left: 0;
        top: 0;
        width: var(--monster-size);
        height: var(--monster-size);
        background: transparent;
        box-shadow: var(--monster-shadow);
      }

      .site-home-logo.is-home {
        pointer-events: none;
        opacity: 0.88;
      }

      @media (max-width: 760px) {
        .site-home-logo {
          top: 12px;
          left: 12px;
          width: 54px;
          height: 50px;
        }
      }
    `;
    document.head.append(style);
  }

  function canonicalPath(pathname) {
    const shortPath = pathname.split("/").pop() || "index.html";
    const localPath = shortPath ? `./${shortPath}` : "./";
    const searchParams = new URLSearchParams(window.location.search);
    if (localPath === "./crtvideo.html" && searchParams.get("workspace") === "motion") {
      return "./motionvideo.html";
    }
    const match = TAB_CONFIG.find((tab) => tab.href === localPath || tab.aliases?.includes(localPath));
    return match?.href || localPath;
  }

  function rebuildNav(nav) {
    const activeHref = canonicalPath(window.location.pathname);
    const linkTarget = window.self !== window.top ? ' target="_top"' : "";
    const vfxTabs = TAB_CONFIG.filter((tab) => tab.group === "vfx98");
    const renderTab = (tab) => {
      const classes = ["mode-tab"];
      if (tab.href === activeHref) {
        classes.push("active");
      }
      return `<a class="${classes.join(" ")}" href="${tab.href}"${linkTarget}>${tab.label}</a>`;
    };

    nav.innerHTML = [
      `<span class="mode-tab-group" aria-hidden="true">VFX 98</span>`,
      ...vfxTabs.map(renderTab),
    ].join("");
  }

  function ensureHomeLogo() {
    if (document.querySelector(".site-home-logo")) {
      return;
    }

    const logo = document.createElement("a");
    logo.className = "site-home-logo";
    logo.href = HOME_HREF;
    if (window.self !== window.top) {
      logo.target = "_top";
    }
    logo.setAttribute("aria-label", "Datamosh home");
    logo.innerHTML = '<span class="site-home-monster" aria-hidden="true"></span>';
    if (canonicalPath(window.location.pathname) === "./datamosh.html") {
      logo.classList.add("is-home");
    }
    document.body.append(logo);
  }

  function enhanceNav(nav) {
    if (!nav || nav.dataset.dropdownReady === "true") {
      return;
    }

    rebuildNav(nav);
    nav.dataset.dropdownReady = "true";
  }

  ensurePixelFont();
  injectStyles();
  document.querySelectorAll("nav.mode-tabs").forEach(enhanceNav);
  ensureHomeLogo();
})();
