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

    // ═══════════════════════════════════════════════════════════════════
    // DEPLOY — OTA bundle download, verify, and reload
    // ═══════════════════════════════════════════════════════════════════

    // Downloads a gzipped JS bundle, decompresses, verifies SHA256,
    // saves to the app's Documents directory. Returns the local path.
    AsyncFunction("deployDownloadBundle") { (url: String, expectedSha256: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard let downloadUrl = URL(string: url) else {
            promise.reject("ERR_INVALID_URL", "Invalid bundle URL")
            return
          }

          let fm = FileManager.default
          let deployDir = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("sankofa_deploy", isDirectory: true)
          try? fm.createDirectory(at: deployDir, withIntermediateDirectories: true)

          let tempFile = deployDir.appendingPathComponent("bundle_temp.jsbundle.gz")
          let finalFile = deployDir.appendingPathComponent("bundle.jsbundle")

          // 1. Download
          let data = try Data(contentsOf: downloadUrl)
          try data.write(to: tempFile)

          // 2. Decompress gzip
          let decompressed = try Data(contentsOf: tempFile).gunzipped()
          try decompressed.write(to: finalFile)
          try? fm.removeItem(at: tempFile)

          // 3. Verify SHA256
          let hash = decompressed.sha256Hex()
          guard hash == expectedSha256 else {
            try? fm.removeItem(at: finalFile)
            promise.reject("ERR_HASH_MISMATCH", "SHA256 mismatch: expected=\(expectedSha256) actual=\(hash)")
            return
          }

          // 4. Persist the bundle path
          UserDefaults.standard.set(finalFile.path, forKey: "sankofa_deploy_bundle_path")

          promise.resolve(finalFile.path)
        } catch {
          promise.reject("ERR_DOWNLOAD", "Bundle download failed: \(error.localizedDescription)")
        }
      }
    }

    // Returns the path of the installed OTA bundle, or nil.
    Function("deployGetBundlePath") { () -> String? in
      guard let path = UserDefaults.standard.string(forKey: "sankofa_deploy_bundle_path"),
            FileManager.default.fileExists(atPath: path) else {
        return nil
      }
      return path
    }

    // Deletes the OTA bundle and resets to the embedded bundle.
    Function("deployClearBundle") {
      if let path = UserDefaults.standard.string(forKey: "sankofa_deploy_bundle_path") {
        try? FileManager.default.removeItem(atPath: path)
      }
      UserDefaults.standard.removeObject(forKey: "sankofa_deploy_bundle_path")
    }

    // Triggers a JS bundle reload.
    Function("deployReload") {
      DispatchQueue.main.async {
        // Try Expo Updates first
        if let updatesClass = NSClassFromString("EXUpdatesAppController") as? NSObject.Type,
           let controller = updatesClass.value(forKey: "sharedInstance") as? NSObject {
          controller.perform(NSSelectorFromString("requestRelaunch"))
          return
        }
        // Fallback: RCTBridge reload
        NotificationCenter.default.post(name: NSNotification.Name("RCTBridgeWillReloadNotification"), object: nil)
      }
    }
  }
}
