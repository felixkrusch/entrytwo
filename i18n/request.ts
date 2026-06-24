import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => {
  // Start with 'en' only. We are i18n-ready from day one.
  // Later we will support multiple locales.
  const locale = 'en';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
