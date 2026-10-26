import { test as base, expect, type BrowserContext } from '@playwright/test';

export async function seedGermanLanguage(context: BrowserContext) {
  await context.addInitScript(() => { localStorage.setItem('im-overdue-language', 'de'); });
}

// The existing German regression suite declares its language instead of relying
// on the product default. New default-language tests opt out with null.
export const test = base.extend<{ appLanguage: 'en' | 'de' | null }>({
  appLanguage: ['de', { option: true }],
  context: async ({ context, appLanguage }, use) => {
    if (appLanguage) await context.addInitScript(language => { localStorage.setItem('im-overdue-language', language); }, appLanguage);
    await use(context);
  },
});
export { expect };
