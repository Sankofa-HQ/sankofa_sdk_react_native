# sankofa-react-native

> **Sankofa SDK for React Native** — analytics, error tracking (Crashlytics + Sentry merged), feature flags, remote config, OTA updates, in-app surveys, heatmaps, and session replay. Wraps the native iOS & Android Sankofa SDKs through Expo Modules.

---

## Installation

```bash
# npm
npm install sankofa-react-native

# yarn
yarn add sankofa-react-native
```

> ⚠️ This package requires a **development build** (`expo run:ios` / `expo run:android`). Native modules for session replay and heatmaps are not supported in Expo Go.

---

## Quick Start

### 1. Initialize (once, at app root)

One line — Catch auto-installs on both JS and native sides. JS errors AND iOS NSException / Android JVM-uncaught all flow through `Sankofa.captureException`.

```tsx
// app/_layout.tsx
import { Sankofa } from 'sankofa-react-native';

Sankofa.initialize('YOUR_API_KEY', {
  endpoint: 'https://api.sankofa.dev',
  recordSessions: true,
  debug: __DEV__,
  // Catch (defaults shown — enableCatch is true by default).
  enableCatch: true,
  catchEnvironment: 'production',
  release: 'myapp@1.4.0',
  // Optional Sentry-style hook to scrub PII / drop noise.
  beforeSend: (event) => {
    if (event.message?.includes('ResizeObserver loop limit')) return null;
    return event;
  },
});
```

### 2. Tag screens

Two patterns — pick one:

```tsx
// Pattern A — per-screen hook (Expo Router-friendly)
import { useSankofaScreen } from 'sankofa-react-native';

function CheckoutScreen() {
  useSankofaScreen('Checkout');
  // ...
}
```

```tsx
// Pattern B — auto-tag every screen from @react-navigation/native
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { useSankofaNavigationTracking } from 'sankofa-react-native';

export default function App() {
  const navRef = useNavigationContainerRef();
  useSankofaNavigationTracking(navRef);
  return (
    <NavigationContainer ref={navRef}>
      <RootStack />
    </NavigationContainer>
  );
}
```

### 3. Capture errors

```tsx
import { Sankofa } from 'sankofa-react-native';

// Capture handled exceptions from anywhere
try {
  await chargeCard(amount);
} catch (err) {
  Sankofa.captureException(err);
}

// Crashlytics-style breadcrumb log — rides on next capture, doesn't bill.
Sankofa.log('checkout: applying coupon SUMMER25');

// Sentry-style temporary scope
Sankofa.withScope((scope) => {
  scope.setTag('checkout_step', 'payment');
  scope.setLevel('warning');
  Sankofa.captureException(err);
});
```

---

## API Reference

| Method | Description |
|---|---|
| `Sankofa.initialize(apiKey, config?)` | Initialize SDK + JS-side Catch + native iOS/Android Catch bridges. |
| `Sankofa.track(event, props?)` | Track custom events. `$screen_name` is auto-injected. |
| `Sankofa.identify(userId)` | Link anonymous session to a known user. |
| `Sankofa.setPerson(traits)` | Set profile attributes. |
| `Sankofa.reset()` | Clear identity & start a fresh session (logout). |
| `Sankofa.flush()` | Force-drain analytics queue. |
| `useSankofaScreen(name)` | Per-screen hook — tags the current screen on mount. |
| `useSankofaNavigationTracking(navRef)` | App-shell hook — auto-tags every React Navigation screen change. |
| **Catch — Crashlytics + Sentry merged** | |
| `Sankofa.captureException(err, opts?)` | Capture a handled exception. |
| `Sankofa.captureMessage(msg, opts?)` | Non-error event. |
| `Sankofa.log(msg, category?)` | Crashlytics-style breadcrumb. Doesn't bill. |
| `Sankofa.setUser` / `setTag(s)` / `setExtra` / `addBreadcrumb` | Ambient context. |
| `Sankofa.withScope(fn)` | Temporary scope overlay. |
| `Sankofa.flushCatch()` | Force-flush Catch events. |
| **Switch / Config / Pulse / Deploy** | |
| `new SankofaSwitch({...})` | Construct a flag client. |
| `new SankofaConfig({...})` | Construct a remote-config client. |
| `new SankofaPulse({...})` | Construct a Pulse survey client. |
| `new SankofaDeploy({...})` | Construct an OTA / Deploy client. |

---

## Native Linking

Standard React Native autolinking.

- **iOS**: CocoaPods. Run `pod install` in `ios/` (or `npx expo run:ios`).
- **Android**: Gradle. Dependencies resolve automatically via Maven Central.

---

## Sankofa Deploy

Push OTA JavaScript updates to your users without going through the App Store. Uses the same API key as analytics.

```tsx
import { Sankofa, SankofaDeploy } from 'sankofa-react-native';

Sankofa.initialize('sk_live_...', { endpoint: 'https://api.sankofa.dev' });

const deploy = new SankofaDeploy();
deploy.checkForUpdate().then((update) => {
  if (update.updateAvailable) deploy.downloadAndApply(update);
});
```

### Expo Prebuild

```json
{ "expo": { "plugins": ["sankofa-react-native"] } }
```

```bash
npx expo prebuild
```

### Bare React Native

```bash
sankofa init
```

Adds the OTA bundle provider to `MainApplication.kt` and `AppDelegate.swift`. If auto-patching fails, the CLI prints the exact code to add manually.

---

## Documentation

Full API reference and integration guides: [docs.sankofa.dev/sdks/react-native](https://docs.sankofa.dev/sdks/react-native/overview).

---

## License

MIT © Sankofa Team
