import { getRequestConfig } from 'next-intl/server';
import { prisma } from '@/lib/prisma';

const loadMessages = {
  en: () => import('../messages/en.json').then(module => module.default),
  de: () => import('../messages/de.json').then(module => module.default),
};

export default getRequestConfig(async () => {
  // Use company.defaultLanguage (en/de) as the app-wide default locale.
  // Falls back to 'en' if not set or if the translation file is missing.
  let locale: 'en' | 'de' = 'en';

  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'company.defaultLanguage' },
    });
    const val = (setting?.value as any)?.value;
    if (val === 'de') locale = 'de';
  } catch {
    // ignore, keep 'en'
  }

  let messages: Record<string, unknown>;
  try {
    messages = await loadMessages[locale]();
  } catch {
    locale = 'en';
    messages = await loadMessages.en();
  }

  return {
    locale,
    messages,
  };
});
