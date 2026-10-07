import { englishTranslations } from '../ui/language/en';

export class Translation {
  private translationMap: { [key: string]: string | string[] };

  constructor(customTranslations?: { [key: string]: string | string[] }) {
    this.translationMap = englishTranslations;

    if (customTranslations) {
      for (const key in customTranslations) {
        if (key in englishTranslations && this.isValidTranslation(customTranslations[key])) {
          this.translationMap[key] = customTranslations[key];
        }
      }
    }
  }

  /**
   * Validates the translation.
   * @param value
   * @returns Whether the translation is valid.
   */
  private isValidTranslation(value: string | string[]): boolean {
    return Array.isArray(value)
      ? value.every(item => typeof item === 'string')
      : typeof value === 'string';
  }

  /**
   * Get translation by key.
   * @param key
   * @returns
   */
  public _t(key: string): string | string[] | undefined {
    const translation = this.translationMap[key];
    return Array.isArray(translation) ? [...translation] : translation;
  }
}
