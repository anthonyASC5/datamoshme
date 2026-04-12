(function () {
  const HOME_HREF = "../index.html";
  const TAB_CONFIG = [
    { href: HOME_HREF, label: "Data Mosh", pixel: true, aliases: ["./index.html", "./", "./datamosh.html"] },
    { href: "./crtvideo.html", label: "CRT Video", pixel: false },
    { href: "./motionvideo.html", label: "Motion Video", pixel: false },
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
      .site-home-logo {
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 999;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 12px 18px 10px;
        border: 2px solid #ffd45b;
        border-radius: 0;
        background:
          linear-gradient(180deg, #ffbf36 0%, #ff8a1e 45%, #ff6300 100%);
        color: #fff8eb;
        text-decoration: none;
        text-transform: uppercase;
        letter-spacing: 0.16rem;
        box-shadow:
          0 12px 30px rgba(255, 98, 0, 0.35),
          inset 0 1px 0 rgba(255, 255, 255, 0.45),
          inset 0 -2px 0 rgba(130, 40, 0, 0.28);
        transition:
          transform 180ms ease,
          box-shadow 180ms ease,
          filter 180ms ease;
      }

      .site-home-logo:hover,
      .site-home-logo:focus-visible {
        transform: translateY(-2px) scale(1.04);
        filter: saturate(1.08);
        box-shadow:
          0 18px 36px rgba(255, 98, 0, 0.42),
          0 0 24px rgba(255, 180, 64, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.55),
          inset 0 -2px 0 rgba(130, 40, 0, 0.22);
      }

      .site-home-logo span {
        font-family: "Press Start 2P", "VT323", "Courier New", monospace;
        font-size: 0.72rem;
        line-height: 1.2;
        text-shadow: 0 1px 0 rgba(120, 44, 0, 0.45);
      }

      .site-home-logo.is-home {
        pointer-events: none;
        opacity: 0.88;
      }

      @media (max-width: 760px) {
        .site-home-logo {
          top: 12px;
          left: 12px;
          min-height: 42px;
          padding: 10px 14px 9px;
        }

        .site-home-logo span {
          font-size: 0.62rem;
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
    nav.innerHTML = TAB_CONFIG.map((tab) => {
      const classes = ["mode-tab"];
      if (tab.pixel) {
        classes.push("pixel");
      }
      if (tab.href === activeHref) {
        classes.push("active");
      }
      return `<a class="${classes.join(" ")}" href="${tab.href}"${linkTarget}>${tab.label}</a>`;
    }).join("");
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
    logo.innerHTML = "<span>MOSH!</span>";
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
