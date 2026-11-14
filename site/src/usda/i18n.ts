import messages from './messages.json';
import cropNames from './crop-names.json';
export type Language = 'en' | 'es' | 'zh-CN';
export type MessageKey = keyof typeof messages;
export const languages: Language[] = ['en', 'es', 'zh-CN'];
export function normalizeLanguage(
  value: string | null | undefined,
): Language | null {
  if (!value) return null;
  if (/^zh(?:-|$)/i.test(value)) return 'zh-CN';
  if (/^es(?:-|$)/i.test(value)) return 'es';
  if (/^en(?:-|$)/i.test(value)) return 'en';
  return null;
}
function initialLanguage(): Language {
  const requested = normalizeLanguage(
    new URLSearchParams(location.search).get('lang'),
  );
  if (requested) return requested;
  try {
    const saved = normalizeLanguage(
      localStorage.getItem('crop-atlas-language'),
    );
    if (saved) return saved;
  } catch {
    /* Storage can be disabled; URL and browser preferences still work. */
  }
  return navigator.languages.map(normalizeLanguage).find(Boolean) ?? 'en';
}
export let language: Language = initialLanguage();
export function t(
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  return messages[key][language].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? `{${name}}`),
  );
}
export function cropName(name: string): string {
  const normalized = name.trim();
  if (language === 'en') return normalized;
  if (normalized === 'NoData') return t('noData');
  const code = normalized.match(/^Class (\d+)$/)?.[1];
  if (code) return t('classCode', { code });
  const entry = cropNames[normalized as keyof typeof cropNames];
  return entry?.[language] ?? normalized;
}
export function placeName(code: string, original: string): string {
  if (code === 'US') return t('conusPlace');
  if (code === 'AK') return t('alaskaPlace');
  if (language === 'zh-CN') return original;
  const english = original.split(' · ')[0]!;
  const spanish: Record<string, string> = {
    HI: 'Hawái',
    NM: 'Nuevo México',
    NY: 'Nueva York',
    NC: 'Carolina del Norte',
    SC: 'Carolina del Sur',
    ND: 'Dakota del Norte',
    SD: 'Dakota del Sur',
    WV: 'Virginia Occidental',
    NJ: 'Nueva Jersey',
    NH: 'Nuevo Hampshire',
    RI: 'Rhode Island',
    DC: 'Distrito de Columbia',
  };
  return language === 'es' ? (spanish[code] ?? english) : english;
}
export function number(value: number, digits = 2): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
export function text(
  element: HTMLElement,
  key: MessageKey,
  values: Record<string, string | number> = {},
) {
  element.dataset.i18n = key;
  element.dataset.i18nValues = JSON.stringify(values);
  element.textContent = t(key, values);
}
export function clearText(element: HTMLElement) {
  delete element.dataset.i18n;
  delete element.dataset.i18nValues;
  element.textContent = '';
}
export function applyLanguage() {
  document.documentElement.lang = language;
  document.title = t('title');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', t('metaDescription'));
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(
      element.dataset.i18n as MessageKey,
      JSON.parse(element.dataset.i18nValues ?? '{}'),
    );
  });
  document
    .querySelectorAll<HTMLElement>('[data-i18n-aria]')
    .forEach((element) => {
      element.setAttribute(
        'aria-label',
        t(element.dataset.i18nAria as MessageKey),
      );
    });
  for (const [selector, key] of [
    ['.maplibregl-ctrl-zoom-in', 'zoomIn'],
    ['.maplibregl-ctrl-zoom-out', 'zoomOut'],
    ['.maplibregl-ctrl-attrib-button', 'attribution'],
    ['.maplibregl-marker', 'mapMarker'],
    ['.maplibregl-canvas', 'mapLabel'],
  ] as const) {
    document.querySelectorAll(selector).forEach((element) => {
      element.setAttribute('aria-label', t(key));
      element.setAttribute('title', t(key));
    });
  }
  (document.getElementById('language') as HTMLSelectElement).value = language;
}
export function setLanguage(value: string) {
  language = normalizeLanguage(value) ?? 'en';
  try {
    localStorage.setItem('crop-atlas-language', language);
  } catch {
    /* URL persists the choice when storage is unavailable. */
  }
  applyLanguage();
}
