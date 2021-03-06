import {useContext} from "react";
import {dissoc, mergeDeepRight, path, reverse} from "ramda";
import {defaultSettings, TranslationContext} from "./context.js";
import {extend, Translation} from "./translation.js";
import type {PackedPlugin} from "./plugin.js";
import {
    Language,
    TemplateFunction,
    TranslationMap,
    TranslationProperties,
    Translation as TranslationOfTranslationMap,
} from "./basic.js";

const getModifiers = (key: string) => {
    const [, ...modifiers] = key.split("_");
    return modifiers;
};

const replaceAll =
    typeof String.prototype.replaceAll === "function"
        ? (string: string, token: string, newToken: string) => {
              return string.replaceAll(token, newToken);
          }
        : (string: string, token: string, newToken: string) => {
              if (token != newToken)
                  while (string.indexOf(token) > -1) {
                      string = string.replace(token, newToken);
                  }
              return string;
          };

const applyPlugins = (keys: string[], params: TranslationProperties, packedPlugins: PackedPlugin[]) => {
    let remainingKeys = keys.map(key => {
        const modifiers = getModifiers(key);
        return {
            key,
            modifiers,
            remainingModifiers: modifiers,
        };
    });
    if (remainingKeys.length === 1) {
        return remainingKeys[0]["key"];
    }
    for (const {plugin, name} of packedPlugins) {
        const modifiers = plugin(params);
        for (const modifier of modifiers) {
            const keysWithModifiers = remainingKeys.filter(({remainingModifiers}) =>
                remainingModifiers.includes(modifier),
            );
            if (keysWithModifiers.length === 0) {
                console.warn(`[${name}]`, "modifier", modifier, "ignored");
                continue;
            } else if (keysWithModifiers.length === 1) {
                return keysWithModifiers[0]["key"];
            } else {
                remainingKeys = keysWithModifiers.map(key => ({
                    ...key,
                    remainingModifiers: key.remainingModifiers.filter(m => m !== modifier),
                }));
            }
        }
    }
    let minKey = remainingKeys[0];
    for (const key of remainingKeys) {
        const currentKeyLength = key.remainingModifiers.length;
        if (currentKeyLength === 0) {
            console.warn("fallback for key with no modifiers", key.key);
            return key.key;
        }
        if (currentKeyLength < minKey.remainingModifiers.length) {
            minKey = key;
        }
    }
    console.warn("not exact match for", minKey.key);
    return minKey.key;
};

const getTranslation = (
    translationMap: TranslationMap,
    lang: Language,
    key: string,
    params: TranslationProperties,
    plugins: PackedPlugin[],
): string | number | TemplateFunction | null => {
    if (key == null) {
        return null;
    }
    const [translationKey, ...parent] = reverse(key.split("."));
    const parentTranslation = path(reverse(parent), translationMap[lang]);
    if (typeof parentTranslation != "object" || parentTranslation == null) {
        return null;
    }
    const keys = Object.keys(parentTranslation);
    if (keys.length === 0) {
        return null;
    }
    const suitableKeys = keys.filter(k => k === translationKey || k.startsWith(translationKey + "_"));

    if (suitableKeys.length == 0) {
        return null;
    }
    // suitable keys are more than 1, then applyPlugins
    if (Array.isArray(plugins) && plugins.length === 0) {
        return parentTranslation[translationKey as keyof typeof parentTranslation];
    }
    const finalKey = applyPlugins(suitableKeys, params, plugins);

    return parentTranslation[finalKey as keyof typeof parentTranslation];
};

const applyTemplate = (str: string, params: TranslationProperties) => {
    const variables = Object.keys(params);
    if (variables.length === 0) {
        return str;
    }
    return variables.reduce((ft: string, key: string) => {
        return replaceAll(ft, `{{${key}}}`, params[key].toString());
    }, str);
};

export const translate = (
    translationMap: TranslationMap,
    lang: Language,
    key: string,
    params: TranslationProperties = {},
    fallbackLanguages: Language[],
    plugins: PackedPlugin[],
): string => {
    const translation =
        getTranslation(
            translationMap,
            lang,
            key,
            params,
            plugins.filter(plugin => plugin.supportedLanguages.includes(lang)),
        ) ??
        fallbackLanguages.reduce((fallback, fallbackLanguage) => {
            if (fallback != null) return fallback;

            return getTranslation(
                translationMap,
                fallbackLanguage,
                key,
                params,
                plugins.filter(plugin => plugin.supportedLanguages.includes(fallbackLanguage)),
            );
        }, null as string | number | TemplateFunction | null);

    if (translation == null) {
        return key;
    }
    if (typeof translation === "object") {
        return translate(translationMap, lang, `${key}.default`, params, fallbackLanguages, plugins) ?? key;
    }
    if (typeof translation === "function") {
        return translation(params);
    }
    if (typeof translation === "number") {
        return translation.toString();
    }
    if (typeof translation === "string") {
        return applyTemplate(translation, params);
    }
    return key;
};

export const generateTranslationFunction = (
    translations: TranslationMap,
    language: Language,
    fallbackLanguages: Language[],
    plugins: PackedPlugin[],
    options: UseTranslationOptions,
) => {
    return (key: string, params?: TranslationProperties, enforceLanguage?: Language) => {
        const currentLanguage = enforceLanguage ?? language ?? fallbackLanguages[0];
        const preparedKey = typeof options.prefix === "string" ? `${options.prefix}.${key}` : key;
        return translate(translations, currentLanguage, preparedKey, params, fallbackLanguages, plugins);
    };
};

const isPlainObject = <TIsType extends Object = Object>(o: unknown): o is TIsType => {
    return Object.prototype.toString.call(o) === "[object Object]";
};
type DictMapper<T> = (key: string, path: string, children: string[]) => T;

export const generateDictFunction = (
    translationMap: TranslationMap,
    language: Language,
    fallbackLanguage: Language,
) => {
    const ramdaPath = path;
    return <T = string>(
        path: string | null,
        mapper: DictMapper<T> = key => key as unknown as T,
        enforceLanguage?: Language,
    ): T[] => {
        const finalLanguage = enforceLanguage ?? language ?? fallbackLanguage;
        const finalPath = path == null ? [finalLanguage as string] : [finalLanguage as string].concat(path.split("."));

        const subMap = ramdaPath(finalPath, translationMap);
        if (!isPlainObject<TranslationOfTranslationMap>(subMap)) return [];

        return Object.keys(subMap)
            .filter(key => key !== "default")
            .map(key => {
                const children = isPlainObject<TranslationOfTranslationMap>(subMap[key])
                    ? Object.keys(subMap[key]).filter(key => key !== "default")
                    : [];
                return mapper(key, path == null ? key : `${path}.${key}`, children);
            });
    };
};

export type DictFunction = ReturnType<typeof generateDictFunction>;

type UseTranslationOptions = {
    prefix?: string;
};

export const useTranslation = (translation?: Translation | TranslationMap, options?: UseTranslationOptions) => {
    const settingsPatch = useContext(TranslationContext);
    const settings = mergeDeepRight(defaultSettings, settingsPatch);
    const {fallbackLanguages, translations, plugins} = settings;
    const translationMap = translation == null ? translations : extend(translations, translation).translationMap;

    return {
        t: generateTranslationFunction(
            translationMap,
            settings.language,
            fallbackLanguages as Language[],
            plugins as PackedPlugin[],
            options ?? {},
        ),
        language: settings?.language ?? fallbackLanguages[0],
        fallbackLanguages,
    };
};

export type UseTranslationResponse = ReturnType<typeof useTranslation>;
