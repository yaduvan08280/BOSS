export const USER_STATUS = ['ACTIVE', 'INACTIVE', 'LEFT'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
