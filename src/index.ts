import SankofaNativeModule from './SankofaModule';
import type { SankofaConfig, SankofaPersonTraits } from './SankofaTypes';

export type { SankofaConfig, SankofaPersonTraits };
export { useSankofaScreen } from './hooks/useSankofaScreen';

/**
 * # Sankofa React Native SDK
 *
 * The primary entry point for all analytics operations.
 * Bridges to the native iOS (SankofaIOS) and Android (Sankofa) SDKs.
 *
 * ## Quick Start
 * ```tsx
 * // In your root _layout.tsx or App.tsx:
 * import { Sankofa } from 'sankofa-react-native';
 *
 * Sankofa.initialize('YOUR_API_KEY', {
 *   endpoint: 'https://api.sankofa.dev',
 *   recordSessions: true,
 * });
 *
 * // In any screen:
 * import { useSankofaScreen, Sankofa } from 'sankofa-react-native';
 *
 * const HomeScreen = () => {
 *   useSankofaScreen('Home');
 *   return <Button onPress={() => Sankofa.track('cta_clicked')} title="Go" />;
 * };
 * ```
 */
export const Sankofa = {
  /**
   * Initialize the SDK. Call once at app startup, before any other method.
   *
   * @param apiKey - Your Sankofa project API key.
   * @param config - Optional configuration overrides.
   */
  initialize(apiKey: string, config: SankofaConfig = {}): void {
    SankofaNativeModule.initialize(apiKey, {
      endpoint: config.endpoint ?? 'https://api.sankofa.dev',
      debug: config.debug ?? false,
      trackLifecycleEvents: config.trackLifecycleEvents ?? true,
      recordSessions: config.recordSessions ?? true,
      maskAllInputs: config.maskAllInputs ?? true,
      flushIntervalSeconds: config.flushIntervalSeconds ?? 30,
      batchSize: config.batchSize ?? 50,
    });
  },

  /**
   * Explicitly tag the screen the user is currently viewing.
   * Crucial for building accurate Heatmaps in the dashboard.
   *
   * Prefer using the `useSankofaScreen` hook instead in function components.
   *
   * @param name - Human-readable screen name.
   * @param properties - Optional extra properties attached to the $screen_view event.
   */
  screen(name: string, properties: Record<string, unknown> = {}): void {
    SankofaNativeModule.screen(name, properties);
  },

  /**
   * Track a custom event with optional properties.
   * The SDK automatically attaches the current screen name as `$screen_name`.
   *
   * @param event - Event name (e.g. 'pay_clicked', 'item_added').
   * @param properties - Optional key-value metadata for the event.
   */
  track(event: string, properties: Record<string, unknown> = {}): void {
    SankofaNativeModule.track(event, properties);
  },

  /**
   * Identify a logged-in user. Merges anonymous history into the user profile.
   *
   * @param userId - Your app's unique user identifier.
   */
  identify(userId: string): void {
    SankofaNativeModule.identify(userId);
  },

  /**
   * Set profile attributes for the current user.
   *
   * @param traits - User traits like name, email, avatar, or custom fields.
   */
  setPerson(traits: SankofaPersonTraits): void {
    SankofaNativeModule.setPerson(traits);
  },

  /**
   * Reset identity and start a fresh anonymous session.
   * Call on logout.
   */
  reset(): void {
    SankofaNativeModule.reset();
  },

  /**
   * Force an immediate upload of all queued events.
   */
  flush(): void {
    SankofaNativeModule.flush();
  },
};
