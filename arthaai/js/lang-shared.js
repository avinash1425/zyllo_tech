/**
 * Shared language preference across ArthaAI modules.
 * Include this script on every page to enable the nav language selector.
 * Uses localStorage key 'arthaai-language' (unified).
 */
(function () {
  const LANG_KEY = 'arthaai-language';
  // Migrate from old key if present
  const oldKey = 'arthaai-chat-language';
  if (!localStorage.getItem(LANG_KEY) && localStorage.getItem(oldKey)) {
    localStorage.setItem(LANG_KEY, localStorage.getItem(oldKey));
  }

  const LANGS = [
    { code: 'en', label: '🇮🇳 English' },
    { code: 'hi', label: 'हिन्दी' },
    { code: 'te', label: 'తెలుగు' },
    { code: 'ta', label: 'தமிழ்' },
    { code: 'mr', label: 'मराठी' },
    { code: 'bn', label: 'বাংলা' },
    { code: 'gu', label: 'ગુજરાતી' },
    { code: 'kn', label: 'ಕನ್ನಡ' },
    { code: 'ml', label: 'മലയാളം' },
    { code: 'pa', label: 'ਪੰਜਾਬੀ' },
    { code: 'or', label: 'ଓଡ଼ିଆ' },
    { code: 'as', label: 'অসমীয়া' },
    { code: 'ur', label: 'اردو' },
    { code: 'sa', label: 'संस्कृतम्' },
    { code: 'mai', label: 'मैथिली' },
    { code: 'kok', label: 'कोंकणी' },
    { code: 'doi', label: 'डोगरी' },
    { code: 'bho', label: 'भोजपुरी' },
    { code: 'ne', label: 'नेपाली' },
  ];

  function getSavedLang() {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.find(l => l.code === saved)) return saved;
    const browser = (navigator.language || 'en').split('-')[0].toLowerCase();
    return LANGS.find(l => l.code === browser) ? browser : 'en';
  }

  function buildOptions() {
    return LANGS.map(l => `<option value="${l.code}">${l.label}</option>`).join('');
  }

  function initSelectors() {
    const current = getSavedLang();
    const opts = buildOptions();

    // Desktop nav selector
    document.querySelectorAll('.nav-lang-select').forEach(sel => {
      sel.innerHTML = opts;
      sel.value = current;
      sel.addEventListener('change', function () {
        localStorage.setItem(LANG_KEY, this.value);
        // Also write old key for backward compat with guru chat
        localStorage.setItem(oldKey, this.value);
        syncAll(this.value);
      });
    });

    // Mobile nav selector
    document.querySelectorAll('.mobile-lang-wrap select').forEach(sel => {
      sel.innerHTML = opts;
      sel.value = current;
      sel.addEventListener('change', function () {
        localStorage.setItem(LANG_KEY, this.value);
        localStorage.setItem(oldKey, this.value);
        syncAll(this.value);
      });
    });

    // Also write both keys on first load
    localStorage.setItem(LANG_KEY, current);
    localStorage.setItem(oldKey, current);
  }

  function syncAll(val) {
    document.querySelectorAll('.nav-lang-select, .mobile-lang-wrap select').forEach(s => { s.value = val; });
    // If guru page has its own langSelect, sync it too
    const guruSel = document.getElementById('langSelect');
    if (guruSel) {
      guruSel.value = val;
      guruSel.dispatchEvent(new Event('change'));
    }
  }

  // Expose for other scripts
  window.arthaLang = {
    get: getSavedLang,
    KEY: LANG_KEY,
    LANGS: LANGS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSelectors);
  } else {
    initSelectors();
  }
})();
