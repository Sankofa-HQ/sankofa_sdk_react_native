import ExpoModulesCore

// ─────────────────────────────────────────────────────────────────────────────
// SankofaModule.swift
//
// Expo Module that bridges the Sankofa React Native JS API to the native
// SankofaIOS Swift SDK (SankofaIOS CocoaPod / local source).
//
// Screen tagging is intentionally handled at the React Native JS layer
// (useSankofaScreen hook / Sankofa.screen()) rather than by the native
// UIViewController hierarchy scanner, which is meaningless in RN.
// ─────────────────────────────────────────────────────────────────────────────

public class SankofaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Sankofa")

    // MARK: - initialize
    // Runs on the main queue — SankofaIOS.initialize is @MainActor and sets up
    // UIKit-bound components (CaptureCoordinator, LifecycleObserver).

    Function("initialize") { (apiKey: String, config: [String: Any?]) in
      DispatchQueue.main.async {
        let cfg = SankofaConfig(
          endpoint:             config["endpoint"] as? String ?? "https://api.sankofa.dev",
          debug:                config["debug"] as? Bool ?? false,
          trackLifecycleEvents: config["trackLifecycleEvents"] as? Bool ?? true,
          flushIntervalSeconds: config["flushIntervalSeconds"] as? Double ?? 30,
          batchSize:            config["batchSize"] as? Int ?? 50,
          recordSessions:       config["recordSessions"] as? Bool ?? true,
          maskAllInputs:        config["maskAllInputs"] as? Bool ?? true,
          captureScale:         config["captureScale"] as? CGFloat ?? 0.35
        )
        Sankofa.shared.initialize(apiKey: apiKey, config: cfg)
      }
    }

    // MARK: - screen
    // Called from useSankofaScreen / Sankofa.screen() in JS.
    // This is the authoritative screen-tagging path for React Native —
    // the native UIViewController scanner is bypassed entirely.

    Function("screen") { (name: String, properties: [String: Any?]?) in
      let props = properties?.compactMapValues { $0 } as? [String: Any] ?? [:]
      Sankofa.shared.screen(name, properties: props)
    }

    // MARK: - track

    Function("track") { (event: String, properties: [String: Any?]?) in
      let props = properties?.compactMapValues { $0 } as? [String: Any] ?? [:]
      Sankofa.shared.track(event, properties: props)
    }

    // MARK: - identify
    // Runs on the main queue — identify updates the CaptureCoordinator
    // uploader which is @MainActor.

    Function("identify") { (userId: String) in
      DispatchQueue.main.async {
        Sankofa.shared.identify(userId: userId)
      }
    }

    // MARK: - setPerson

    Function("setPerson") { (traits: [String: Any?]) in
      let name   = traits["name"] as? String
      let email  = traits["email"] as? String
      let avatar = traits["avatar"] as? String
      var extra  = traits.compactMapValues { $0 } as? [String: Any] ?? [:]
      extra.removeValue(forKey: "name")
      extra.removeValue(forKey: "email")
      extra.removeValue(forKey: "avatar")
      Sankofa.shared.setPerson(name: name, email: email, avatar: avatar, properties: extra)
    }

    // MARK: - reset

    Function("reset") {
      Sankofa.shared.reset()
    }

    // MARK: - flush

    Function("flush") {
      Sankofa.shared.flush()
    }
  }
}
