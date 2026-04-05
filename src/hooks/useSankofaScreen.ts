import { useEffect } from 'react';
import SankofaNativeModule from '../SankofaModule';

/**
 * `useSankofaScreen` — The primary Sankofa hook for React Native.
 *
 * Call this at the top of every screen component. It notifies the native
 * Sankofa SDK (iOS / Android) when the component mounts or when the screen
 * name changes, enabling accurate heatmap context for all subsequent events.
 *
 * @example
 * ```tsx
 * import { useSankofaScreen } from 'sankofa-react-native';
 *
 * const CheckoutScreen = () => {
 *   useSankofaScreen('Checkout - Empty');
 *
 *   return (
 *     <View>
 *       <Button onPress={() => Sankofa.track('pay_clicked')} title="Pay" />
 *       {/* The SDK automatically knows this event happened on "Checkout - Empty" *\/}
 *     </View>
 *   );
 * };
 * ```
 *
 * @param screenName - The human-readable screen name shown in the Sankofa dashboard.
 */
export function useSankofaScreen(screenName: string): void {
  useEffect(() => {
    SankofaNativeModule.screen(screenName, {});
  }, [screenName]);
}
