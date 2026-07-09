import { getRequestConfig } from 'next-intl/server';
import { prisma } from '@/lib/prisma';

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
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    locale = 'en';
    messages = (await import(`../messages/en.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
