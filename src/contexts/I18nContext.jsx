import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const I18nContext = createContext(null);
const STORAGE_KEY = 'language';
const FALLBACK_LANG = 'en';
const SUPPORTED_LANGS = ['en', 'hr'];

// On first visit (no localStorage entry) pick a language from the browser
// locale: walk navigator.languages and take the first tag whose base matches
// a supported language. Falls back to FALLBACK_LANG ("en") if nothing matches
// or if navigator is unavailable (SSR / very old runtimes).
function detectSystemLang() {
  if (typeof navigator === 'undefined') return FALLBACK_LANG;
  const candidates = navigator.languages && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || ''];
  for (const tag of candidates) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (SUPPORTED_LANGS.includes(base)) return base;
  }
  return FALLBACK_LANG;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem(STORAGE_KEY) || detectSystemLang());
  const [translations, setTranslations] = useState({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/i18n/${lang}.json`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTranslations(data);
        setReady(true);
      })
      .catch((e) => console.error('Failed to load translations:', e?.message || 'unknown'));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const setLang = useCallback((newLang) => {
    localStorage.setItem(STORAGE_KEY, newLang);
    setLangState(newLang);
  }, []);

  const toggleLang = useCallback(() => {
    setLang(lang === 'en' ? 'hr' : 'en');
  }, [lang, setLang]);

  const t = useCallback(
    (key, placeholders = {}) => {
      const keys = key.split('.');
      let value = translations;
      for (const k of keys) value = value?.[k];
      if (value == null) return key;
      if (typeof value !== 'string') return value;
      let out = value;
      for (const [p, repl] of Object.entries(placeholders)) {
        out = out.replaceAll(`{${p}}`, repl);
      }
      return out;
    },
    [translations]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang, t, ready }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
