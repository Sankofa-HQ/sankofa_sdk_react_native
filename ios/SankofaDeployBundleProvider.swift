import Foundation

@objc(SankofaDeployBundleProvider)
public final class SankofaDeployBundleProvider: NSObject {
  /// UserDefaults flag flipped to `true` on the first invocation —
  /// proves the host's AppDelegate / ReactNativeDelegate actually
  /// wired its `bundleURL()` override into us. `checkIntegration()`
  /// reads this to tell the host "your bundle loader patch is/isn't live."
  private static let wiredFlagKey = "sankofa_deploy_bundle_loader_wired"

  @objc
  public static func bundleURL() -> URL? {
    UserDefaults.standard.set(true, forKey: wiredFlagKey)
    guard let path = UserDefaults.standard.string(forKey: "sankofa_deploy_bundle_path"),
          FileManager.default.fileExists(atPath: path) else {
      return nil
    }
    return URL(fileURLWithPath: path)
  }
}
