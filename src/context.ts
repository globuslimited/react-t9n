import { createContext } from "react";

export enum Language {
    English = "en",
    Russian = "ru",
    Chinese = "zn"
}

export type Translation = {
    [key: string]: Translation | string;
};

export type TranslationMap = {
    [language in Language]?: Translation;
};

export type TranslationSettings = {
    translations: TranslationMap;
    language?: Language;
    fallbackLanguage: Language;
};

export const TranslationContext = createContext<TranslationSettings>({
    fallbackLanguage: Language.English,
    translations: {
        en: {},
    },
});
