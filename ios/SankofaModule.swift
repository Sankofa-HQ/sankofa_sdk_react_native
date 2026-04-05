import ExpoModulesCore

// ─────────────────────────────────────────────────────────────────────────────
// SankofaModule.swift
//
// Expo Module that bridges the Sankofa React Native JS API to the native
// SankofaIOS Swift SDK. Compiled as part of the SankofaReactNative pod which
// includes the SankofaIOS sources directly (see SankofaReactNative.podspec).
// ─────────────────────────────────────────────────────────────────────────────

public class SankofaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Sankofa")

    // MARK: - initialize

    AsyncFunction("initialize") { (apiKey: String, config: [String: Any?]) in
      await MainActor.run {
        let cfg = SankofaConfig(
          endpoint: config["endpoint"] as? String ?? "https://api.sankofa.dev",
          debug: config["debug"] as? Bool ?? false,
          trackLifecycleEvents: config["trackLifecycleEvents"] as? Bool ?? true,
          flushIntervalSeconds: config["flushIntervalSeconds"] as? Double ?? 30,
          batchSize: config["batchSize"] as? Int ?? 50,
          recordSessions: config["recordSessions"] as? Bool ?? true,
          maskAllInputs: config["maskAllInputs"] as? Bool ?? true,
          captureScale: config["captureScale"] as? CGFloat ?? 0.35
        )
        Sankofa.shared.initialize(apiKey: apiKey, config: cfg)
      }
    }

    // MARK: - screen

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

    AsyncFunction("identify") { (userId: String) in
      await MainActor.run {
        Sankofa.shared.identify(userId: userId)
      }
    }

    // MARK: - setPerson

    Function("setPerson") { (traits: [String: Any?]) in
      let name = traits["name"] as? String
      let email = traits["email"] as? String
      var extra = traits.compactMapValues { $0 } as? [String: Any] ?? [:]
      extra.removeValue(forKey: "name")
      extra.removeValue(forKey: "email")
      extra.removeValue(forKey: "avatar")
      Sankofa.shared.setPerson(name: name, email: email, properties: extra)
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
