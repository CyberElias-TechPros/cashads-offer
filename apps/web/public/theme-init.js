// Applies the saved theme before first paint (no flash). External file so the CSP can stay script-src 'self'.
(function () {
  try {
    var t = localStorage.getItem('lucrum.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
