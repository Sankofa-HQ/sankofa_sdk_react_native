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

Deploy checks for OTA JavaScript updates with the same `sk_live_` / `sk_test_` SDK key used by analytics. Publishing releases uses a separate Deploy Token in the CLI.

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

Android release hosts should prefer the Sankofa bundle provider:

```kotlin
import dev.sankofa.rn.SankofaDeployBundleProvider

override fun getJSBundleFile(): String? {
  return SankofaDeployBundleProvider.getJSBundleFile(applicationContext)
    ?: super.getJSBundleFile()
}
```

iOS release hosts should prefer the Sankofa bundle URL before the embedded bundle:

```swift
import SankofaReactNative

override func bundleURL() -> URL? {
  #if DEBUG
  return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
  #else
  if let url = SankofaDeployBundleProvider.bundleURL() {
    return url
  }
  return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
  #endif
}
```

---

## Local Development (Monorepo)

If you are a contributor working inside the Sankofa monorepo, the SDK **automatically detects** the sibling native SDKs and links to their source code for a seamless development experience. No manual configuration is required.

- **iOS**: Automatically links `sankofa_sdk_ios`.
- **Android**: Automatically links `sankofa_sdk_android`.

For external contributors who wish to force a specific mode, you can still use the `SANKOFA_SOURCE_SDK=1` (iOS) or `sankofa.sourceSdk=true` (Android) overrides.

---

## License

MIT © Sankofa Team
