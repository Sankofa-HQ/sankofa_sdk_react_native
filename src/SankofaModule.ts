import { requireNativeModule } from 'expo-modules-core';

/**
 * Low-level reference to the native Sankofa module.
 * Prefer using the `Sankofa` object or `useSankofaScreen` hook from `src/index.ts`.
 */
const SankofaNativeModule = requireNativeModule('Sankofa');

export default SankofaNativeModule;
