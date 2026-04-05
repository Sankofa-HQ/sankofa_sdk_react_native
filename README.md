# sankofa-react-native

> **Sankofa Analytics SDK for React Native** — event tracking, heatmaps, and session replay, powered by the native iOS & Android Sankofa SDKs.

---

## Architecture

```
sankofa-react-native (this package)
├── src/                        JavaScript / TypeScript public API
│   ├── index.ts               Barrel: exports Sankofa object + useSankofaScreen
│   ├── SankofaModule.ts       requireNativeModule('Sankofa') wrapper
│   ├── SankofaTypes.ts        TypeScript interface for SankofaConfig
│   └── hooks/
│       └── useSankofaScreen.ts  ← The primary developer hook
├── ios/
│   └── SankofaModule.swift    Expo Module → SankofaIOS.Sankofa.shared
└── android/
    └── SankofaModule.kt       Expo Module → dev.sankofa.sdk.Sankofa
```

The native session replay runs **entirely on the native layer** — iOS screenshots via `UIWindow` and Android via the existing `ReplayRecorder`. No JS-side screen capture needed.

---

## Installation

```bash
# npm
npm install sankofa-react-native

# yarn
yarn add sankofa-react-native
```

> ⚠️ This package requires a **development build** (`expo run:ios` / `expo run:android`). It will not work in Expo Go.

---

## Quick Start

### 1. Initialize (once, at app root)

```tsx
// app/_layout.tsx
import { Sankofa } from 'sankofa-react-native';

Sankofa.initialize('YOUR_API_KEY', {
  endpoint: 'https://api.sankofa.dev',
  recordSessions: true,
  debug: true,           // disable in production
});
```

### 2. Tag every screen with one hook

```tsx
import { useSankofaScreen, Sankofa } from 'sankofa-react-native';

const CheckoutScreen = () => {
  // 🚀 One line. Auto-tags the screen when the component mounts.
  useSankofaScreen('Checkout - Empty');

  return (
    <View>
      <Button
        onPress={() => Sankofa.track('pay_clicked')}
        title="Pay"
      />
      {/* The SDK automatically knows this click happened on "Checkout - Empty" */}
    </View>
  );
};
```

### 3. Identify users

```tsx
// On login
Sankofa.identify('user_42');
Sankofa.setPerson({ name: 'Kofi Boateng', email: 'kofi@sankofa.dev' });

// On logout
Sankofa.reset();
```

---

## API Reference

| Method | Description |
|--------|-------------|
| `Sankofa.initialize(apiKey, config?)` | Initialize the SDK. Call once at app start. |
| `useSankofaScreen(name)` | Hook — tags the current screen on mount / name change. |
| `Sankofa.screen(name, props?)` | Imperative version of `useSankofaScreen`. |
| `Sankofa.track(event, props?)` | Track a custom event. `$screen_name` is auto-injected. |
| `Sankofa.identify(userId)` | Link anonymous session to a known user. |
| `Sankofa.setPerson(traits)` | Set profile attributes (`name`, `email`, `avatar`, …). |
| `Sankofa.reset()` | Clear identity & start a fresh anonymous session (logout). |
| `Sankofa.flush()` | Force-upload all queued events immediately. |

### `SankofaConfig`

```ts
interface SankofaConfig {
  endpoint?:            string;   // default: 'https://api.sankofa.dev'
  debug?:               boolean;  // default: false
  trackLifecycleEvents?: boolean; // default: true
  recordSessions?:      boolean;  // default: true
  maskAllInputs?:       boolean;  // default: true
  flushIntervalSeconds?: number;  // default: 30
  batchSize?:           number;   // default: 50
}
```

---

## Example App

See [`example/sankofa_example_react_native`](../../example/sankofa_example_react_native/) for a full Expo SDK 52 demo with:
- **Home** — live event tracker with 6 quick-fire buttons
- **Identify** — user identity flow
- **Replay** — dynamic screen-name switching demo

```bash
cd example/sankofa_example_react_native
npm install
npm run ios      # or: npm run android
```

---

## Native Linking

### iOS (CocoaPods)

The `SankofaReactNative.podspec` compiles the `SankofaIOS` Swift sources directly alongside the Expo bridge — no separate SPM dependency needed. `expo prebuild` handles pod installation automatically.

### Android (Gradle)

Add to your `settings.gradle`:

```groovy
include ':sankofa'
project(':sankofa').projectDir = new File('../../sdks/sankofa_sdk_android/sankofa')
```

The `expo-modules-core` auto-discovery registers `SankofaPackage` via `AndroidManifest.xml` — no `MainApplication.kt` edits required.

---

## License

MIT © Sankofa Team
