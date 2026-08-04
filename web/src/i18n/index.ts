import { createI18n } from 'vue-i18n';
import en from './locales/en';
import zhCN from './locales/zh-CN';

export type Locale = 'en' | 'zh-CN';

function detectLocale(): Locale {
	try {
		const saved = localStorage.getItem('locale');
		if (saved === 'en' || saved === 'zh-CN') return saved;
	} catch { /* ignore */ }
	try {
		const langs = navigator.languages ?? [];
		if (langs.some((l) => l.toLowerCase().startsWith('zh'))) return 'zh-CN';
	} catch { /* ignore */ }
	return 'en';
}

export const i18n = createI18n({
	legacy: false,
	locale: detectLocale(),
	fallbackLocale: 'en',
	messages: { en, 'zh-CN': zhCN },
});

export const availableLocales: { code: Locale; label: string }[] = [
	{ code: 'en', label: 'EN' },
	{ code: 'zh-CN', label: '简' },
];

export function setLocale(code: Locale): void {
	i18n.global.locale.value = code;
	try {
		localStorage.setItem('locale', code);
		document.documentElement.lang = code;
	} catch { /* ignore */ }
}

export function nextLocale(): Locale {
	const codes = availableLocales.map((l) => l.code);
	const idx = codes.indexOf(i18n.global.locale.value as Locale);
	const nxt = codes[(idx + 1) % codes.length];
	setLocale(nxt);
	return nxt;
}

try {
	document.documentElement.lang = i18n.global.locale.value;
} catch { /* ignore */ }
