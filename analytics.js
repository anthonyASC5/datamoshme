const measurementId = globalThis.window?.CRTWRLD_ANALYTICS_ID || "";
const isConfigured = measurementId && measurementId !== "G-XXXXXXXXXX";

globalThis.window.dataLayer = globalThis.window.dataLayer || [];

function gtag(...args) {
  globalThis.window.dataLayer.push(args);
}

if (isConfigured) {
  const existing = document.querySelector(`script[data-gtag-id="${measurementId}"]`);
  if (!existing) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.gtagId = measurementId;
    document.head.appendChild(script);
  }

  gtag("js", new Date());
  gtag("config", measurementId, {
    send_page_view: true,
  });
} else {
  console.info("Google Analytics is not active. Set `window.CRTWRLD_ANALYTICS_ID` in analytics-config.js.");
}

export function analyticsEnabled() {
  return Boolean(isConfigured);
}

export function trackEvent(name, params = {}) {
  if (!isConfigured) {
    return;
  }
  gtag("event", name, params);
}
