# sankofa-react-native

> **Sankofa Analytics SDK for React Native** — event tracking, heatmaps, and session replay, powered by the native iOS & Android Sankofa SDKs.

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

```tsx
// app/_layout.tsx
import { Sankofa } from 'sankofa-react-native';

Sankofa.initialize('YOUR_API_KEY', {
  endpoint: 'https://api.sankofa.dev', // optional
  recordSessions: true,
  debug: __DEV__,
});
```

### 2. Tag screens with the hook

```tsx
import { useSankofaScreen, Sankofa } from 'sankofa-react-native';

const CheckoutScreen = () => {
  // 🚀 Automatically tags the screen context for heatmaps
  useSankofaScreen('Checkout');

  return (
    <View>
      <Button
        onPress={() => Sankofa.track('pay_clicked')}
        title="Pay"
      />
    </View>
  );
};
```

---

## API Reference

| Method | Description |
|--------|-------------|
| `Sankofa.initialize(apiKey, config?)` | Initialize the SDK at app start. |
| `useSankofaScreen(name)` | Hook — tags the current screen for contextual heatmaps. |
| `Sankofa.track(event, props?)` | Track custom events. `$screen_name` is auto-injected. |
| `Sankofa.identify(userId)` | Link anonymous session to a known user. |
| `Sankofa.setPerson(traits)` | Set profile attributes (`name`, `email`, etc.). |
| `Sankofa.reset()` | Clear identity & start a fresh session (logout). |

---

## Native Linking

This package follows standard React Native autolinking. 

- **iOS**: Uses CocoaPods. Run `pod install` in your `ios/` directory (or `npx expo run:ios`).
- **Android**: Uses Gradle. Dependencies are resolved automatically via Maven Central.

## Sankofa Deploy

Push OTA JavaScript updates to your users without going through the App Store. Uses the same API key as analytics.

```tsx
import { Sankofa, SankofaDeploy } from 'sankofa-react-native';

Sankofa.initialize('sk_live_...', {
  endpoint: 'https://api.sankofa.dev',
});

const deploy = new SankofaDeploy();

deploy.checkForUpdate().then((update) => {
  if (update.updateAvailable) {
    deploy.downloadAndApply(update);
  }
});
```

Optional test overrides:

```tsx
const deploy = new SankofaDeploy({
  appVersion: '1.4.2',
  distinctId: 'device-or-user-id',
});
```

### Expo Prebuild

Add the config plugin, then run prebuild:

```json
{
  "expo": {
    "plugins": ["sankofa-react-native"]
  }
}
```

```bash
npx expo prebuild
```

### Bare React Native

For bare React Native projects (without Expo), run the CLI setup command to automatically patch your native files:

```bash
sankofa init
```

This adds the OTA bundle provider to `MainApplication.kt` and `AppDelegate.swift`. If auto-patching fails, the CLI prints the exact code to add manually.

---

## License

MIT © Sankofa Team
