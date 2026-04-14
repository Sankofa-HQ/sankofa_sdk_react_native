import Foundation

@objc(SankofaDeployBundleProvider)
public final class SankofaDeployBundleProvider: NSObject {
  @objc
  public static func bundleURL() -> URL? {
    guard let path = UserDefaults.standard.string(forKey: "sankofa_deploy_bundle_path"),
          FileManager.default.fileExists(atPath: path) else {
      return nil
    }
    return URL(fileURLWithPath: path)
  }
}
