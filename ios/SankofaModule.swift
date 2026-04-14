import ExpoModulesCore
import UIKit
import CommonCrypto
import zlib

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

    // Downloads a gzipped JS bundle, decompresses, verifies SHA256,
    // saves to the app's Documents directory. Returns the local path.
    AsyncFunction("deployDownloadBundle") { (url: String, expectedSha256: String, label: String, promise: Promise) in
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
          let finalFile = deployDir.appendingPathComponent(
            "\(sankofaDeploySanitizeFilePart(label))_\(String(expectedSha256.prefix(12))).jsbundle"
          )

          // 1. Download
          let data = try Data(contentsOf: downloadUrl)
          try data.write(to: tempFile)

          // 2. Decompress gzip
          let decompressed = try Data(contentsOf: tempFile).sankofaDeployGunzipped()
          try decompressed.write(to: finalFile)
          try? fm.removeItem(at: tempFile)

          // 3. Verify SHA256
          let hash = decompressed.sankofaDeploySHA256Hex()
          guard hash == expectedSha256 else {
            try? fm.removeItem(at: finalFile)
            promise.reject("ERR_HASH_MISMATCH", "SHA256 mismatch: expected=\(expectedSha256) actual=\(hash)")
            return
          }

          promise.resolve(finalFile.path)
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

    // Deletes the OTA bundle and resets to the embedded bundle.
    Function("deployClearBundle") {
      if let path = UserDefaults.standard.string(forKey: sankofaDeployBundlePathKey) {
        try? FileManager.default.removeItem(atPath: path)
      }
      UserDefaults.standard.removeObject(forKey: sankofaDeployBundlePathKey)
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

    // MARK: - Deploy metadata and persistent storage

    Function("deployGetAppVersion") { () -> String in
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
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
      [
        "osVersion": UIDevice.current.systemVersion,
        "deviceModel": UIDevice.current.model
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
