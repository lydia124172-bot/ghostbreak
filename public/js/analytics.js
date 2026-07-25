(function () {
  function loadGa(measurementId) {
    if (!measurementId || window.__ghostbreakGaLoaded) return;
    window.__ghostbreakGaLoaded = true;

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', measurementId, { anonymize_ip: true });
  }

  fetch('/api/config')
    .then((res) => res.json())
    .then((cfg) => loadGa(cfg.gaMeasurementId))
    .catch(() => {});
})();
