export type Locale = 'en' | 'zh-CN';
export interface LocaleInfo { code: Locale; label: string; }
export type TranslationKey = string;
export type Translations = Record<string, string>;
