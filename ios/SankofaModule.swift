import ExpoModulesCore
import UIKit
import CommonCrypto
import zlib
import SSZipArchive

private let sankofaDeployBundlePathKey = "sankofa_deploy_bundle_path"
private let sankofaDeployDistinctIdKey = "sankofa_deploy_distinct_id"

private func sankofaDeploySanitizeFilePart(_ value: String) -> String {
  let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
  let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : Character("_") }
  let result = String(scalars).prefix(96)
  return result.isEmpty ? "bundle" : String(result)
}

private extension Data {
  func sankofaDeployGunzipped() throws -> Data {
    guard count > 2, self[0] == 0x1f, self[1] == 0x8b else {
      return self
    }

    var stream = z_stream()
    stream.next_in = UnsafeMutablePointer<Bytef>(
      mutating: (self as NSData).bytes.bindMemory(to: Bytef.self, capacity: count)
    )
    stream.avail_in = uint(count)

    let status = inflateInit2_(&stream, 47, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
    guard status == Z_OK else {
      throw NSError(domain: "SankofaDeploy", code: Int(status), userInfo: [
        NSLocalizedDescriptionKey: "inflateInit2 failed with status \(status)"
      ])
    }

    var decompressed = Data(capacity: count * 2)
    let bufferSize = 32768
    let buffer = UnsafeMutablePointer<Bytef>.allocate(capacity: bufferSize)
    defer {
      inflateEnd(&stream)
      buffer.deallocate()
    }

    var inflateStatus: Int32 = Z_OK
    while inflateStatus != Z_STREAM_END {
      stream.next_out = buffer
      stream.avail_out = uint(bufferSize)
      inflateStatus = inflate(&stream, Z_NO_FLUSH)
      guard inflateStatus == Z_OK || inflateStatus == Z_STREAM_END else {
        throw NSError(domain: "SankofaDeploy", code: Int(inflateStatus), userInfo: [
          NSLocalizedDescriptionKey: "inflate failed with status \(inflateStatus)"
        ])
      }
      let written = bufferSize - Int(stream.avail_out)
      if written > 0 {
        decompressed.append(buffer, count: written)
      }
    }

    return decompressed
  }

  func sankofaDeploySHA256Hex() -> String {
    var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
    withUnsafeBytes {
      _ = CC_SHA256($0.baseAddress, CC_LONG(count), &hash)
    }
    return hash.map { String(format: "%02x", $0) }.joined()
  }
}

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

    // Downloads an OTA archive (zip of bundle.jsbundle + assets/), verifies
    // SHA256 against the downloaded bytes, and unzips into a per-release
    // directory under Application Support. Returns the absolute path to
    // `bundle.jsbundle` inside that directory. RN's AssetSourceResolver
    // resolves `assets/...` relative to the bundle URL's directory, so
    // fonts/images load correctly without any custom asset wiring.
    AsyncFunction("deployDownloadBundle") { (url: String, expectedSha256: String, label: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          guard let downloadUrl = URL(string: url) else {
            promise.reject("ERR_INVALID_URL", "Invalid bundle URL")
            return
          }

          let fm = FileManager.default
          let deployRoot = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("SankofaDeploy", isDirectory: true)
          try? fm.createDirectory(at: deployRoot, withIntermediateDirectories: true)

          let releaseDirName = "\(sankofaDeploySanitizeFilePart(label))_\(String(expectedSha256.prefix(12)))"
          let releaseDir = deployRoot.appendingPathComponent(releaseDirName, isDirectory: true)
          let tempArchive = deployRoot.appendingPathComponent("\(releaseDirName).download.zip")

          // 1. Download
          let data = try Data(contentsOf: downloadUrl)

          // 2. Verify SHA256 of the archive bytes (matches CLI's hash)
          let hash = data.sankofaDeploySHA256Hex()
          guard hash == expectedSha256 else {
            promise.reject("ERR_HASH_MISMATCH", "Archive SHA256 mismatch: expected=\(expectedSha256) actual=\(hash)")
            return
          }
          try data.write(to: tempArchive)

          // 3. Unzip into a fresh release dir. Wipe any prior copy first so
          //    a re-download can't pick up stale files from a partial extract.
          if fm.fileExists(atPath: releaseDir.path) {
            try? fm.removeItem(at: releaseDir)
          }
          try fm.createDirectory(at: releaseDir, withIntermediateDirectories: true)
          guard SSZipArchive.unzipFile(atPath: tempArchive.path, toDestination: releaseDir.path) else {
            try? fm.removeItem(at: tempArchive)
            try? fm.removeItem(at: releaseDir)
            promise.reject("ERR_UNZIP", "Failed to unzip OTA archive")
            return
          }
          try? fm.removeItem(at: tempArchive)

          let bundleFile = releaseDir.appendingPathComponent("bundle.jsbundle")
          guard fm.fileExists(atPath: bundleFile.path) else {
            try? fm.removeItem(at: releaseDir)
            promise.reject("ERR_BUNDLE_MISSING", "Archive did not contain bundle.jsbundle")
            return
          }

          promise.resolve(bundleFile.path)
        } catch {
          promise.reject("ERR_DOWNLOAD", "Bundle download failed: \(error.localizedDescription)")
        }
      }
    }

    // Returns the path of the installed OTA bundle, or nil.
    Function("deployGetBundlePath") { () -> String? in
      guard let path = UserDefaults.standard.string(forKey: sankofaDeployBundlePathKey),
            FileManager.default.fileExists(atPath: path) else {
        return nil
      }
      return path
    }

    // Marks a verified bundle as active for the native bundle loader.
    Function("deploySetBundlePath") { (path: String) in
      guard FileManager.default.fileExists(atPath: path) else {
        throw NSError(domain: "SankofaDeploy", code: 404, userInfo: [
          NSLocalizedDescriptionKey: "Bundle file does not exist: \(path)"
        ])
      }
      UserDefaults.standard.set(path, forKey: sankofaDeployBundlePathKey)
    }

    // Deletes the OTA release directory (bundle + assets) and resets to the
    // embedded bundle. We delete the parent directory because the OTA archive
    // unzips bundle.jsbundle alongside an `assets/` tree.
    Function("deployClearBundle") {
      if let path = UserDefaults.standard.string(forKey: sankofaDeployBundlePathKey) {
        let bundleURL = URL(fileURLWithPath: path)
        let parentDir = bundleURL.deletingLastPathComponent()
        // Sanity check: only delete if it looks like a SankofaDeploy release dir.
        if parentDir.path.contains("/SankofaDeploy/") {
          try? FileManager.default.removeItem(at: parentDir)
        } else {
          try? FileManager.default.removeItem(atPath: path)
        }
      }
      UserDefaults.standard.removeObject(forKey: sankofaDeployBundlePathKey)
    }

    // Triggers a JS bundle reload so the new OTA bundle is picked up.
    //
    // Three strategies, tried in order:
    //   1. Expo Updates (`EXUpdatesAppController.requestRelaunch`). Fully
    //      relaunches the app process, which is the most reliable.
    //   2. React Native's C function `RCTTriggerReloadCommandListeners`.
    //      Resolved dynamically via dlsym because the symbol isn't directly
    //      importable from Swift without an ObjC bridging header. Calling
    //      this C function is what actually works on new-architecture /
    //      bridgeless RN: it invokes every registered `RCTReloadListener`
    //      (the bridge, the bridgeless host) AND posts the notification.
    //   3. Plain `NotificationCenter` post as a last-resort fallback for
    //      older RN versions that don't export the C symbol.
    Function("deployReload") {
      DispatchQueue.main.async {
        NSLog("[SankofaDeploy] deployReload invoked")

        if let updatesClass = NSClassFromString("EXUpdatesAppController") as? NSObject.Type,
           let controller = updatesClass.value(forKey: "sharedInstance") as? NSObject {
          NSLog("[SankofaDeploy] requesting relaunch via Expo Updates")
          controller.perform(NSSelectorFromString("requestRelaunch"))
          return
        }

        // Look up `RCTTriggerReloadCommandListeners` in the current process
        // (it's linked in via React-Core). dlopen(nil, ...) opens the main
        // executable's symbol table without loading anything new.
        typealias TriggerReloadFn = @convention(c) (NSString) -> Void
        if let handle = dlopen(nil, RTLD_NOW),
           let sym = dlsym(handle, "RCTTriggerReloadCommandListeners") {
          NSLog("[SankofaDeploy] calling RCTTriggerReloadCommandListeners")
          let fn = unsafeBitCast(sym, to: TriggerReloadFn.self)
          fn("SankofaDeploy" as NSString)
          return
        }

        NSLog("[SankofaDeploy] falling back to NotificationCenter")
        NotificationCenter.default.post(
          name: NSNotification.Name("RCTTriggerReloadCommandNotification"),
          object: nil,
          userInfo: [
            "RCTTriggerReloadCommandSourceKey": "SankofaDeploy",
            "RCTTriggerReloadCommandReasonKey": "OTA bundle applied",
          ]
        )
      }
    }

    // MARK: - Deploy metadata and persistent storage

    Function("deployGetAppVersion") { () -> String in
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    /// Bridge accessor for the active replay session id. Returns
    /// the empty string when there's no recording (replay sampled
    /// out, recordSessions=false, or pre-handshake); the JS layer
    /// maps that to omitting the field rather than sending "" so
    /// the wire shape distinguishes "no replay" from "replay
    /// session unknown".
    Function("getReplaySessionId") { () -> String in
      MainActor.assumeIsolated {
        Sankofa.shared.replaySessionId ?? ""
      }
    }

    Function("deployGetDistinctId") { () -> String in
      let defaults = UserDefaults.standard
      if let identified = defaults.string(forKey: "dev.sankofa.distinct_id"), !identified.isEmpty {
        return identified
      }
      if let anonymous = defaults.string(forKey: "dev.sankofa.anonymous_id"), !anonymous.isEmpty {
        return anonymous
      }
      if let existing = defaults.string(forKey: sankofaDeployDistinctIdKey), !existing.isEmpty {
        return existing
      }
      let generated = "deploy_\(UUID().uuidString)"
      defaults.set(generated, forKey: sankofaDeployDistinctIdKey)
      return generated
    }

    Function("deployGetDeviceInfo") { () -> [String: String] in
      // Locale is BCP-47 (e.g. "en-US"), normalized to hyphen form so the
      // server-side rules engine can compare against canonical values.
      let rawLocale = Locale.current.identifier
      let locale = rawLocale.replacingOccurrences(of: "_", with: "-")

      // Prefer utsname.machine ("iPhone14,3") over UIDevice.model's generic
      // "iPhone" so targeting rules can exclude specific hardware.
      var sysinfo = utsname()
      uname(&sysinfo)
      var machineValue = sysinfo.machine
      let machineValueCapacity = MemoryLayout.size(ofValue: machineValue)
      let machine = withUnsafePointer(to: &machineValue) {
        $0.withMemoryRebound(to: CChar.self, capacity: machineValueCapacity) {
          String(cString: $0)
        }
      }

      return [
        "osVersion": UIDevice.current.systemVersion,
        "deviceModel": machine.isEmpty ? UIDevice.current.model : machine,
        "locale": locale
      ]
    }

    Function("deployStorageGet") { (key: String) -> String? in
      UserDefaults.standard.string(forKey: key)
    }

    Function("deployStorageSet") { (key: String, value: String) in
      UserDefaults.standard.set(value, forKey: key)
    }

    Function("deployStorageRemove") { (key: String) in
      UserDefaults.standard.removeObject(forKey: key)
    }

    Function("deployStorageMultiRemove") { (keys: [String]) in
      keys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
    }
  }
}
