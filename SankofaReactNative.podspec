require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# ─────────────────────────────────────────────────────────────────────────────
# SankofaReactNative.podspec
#
# This pod is a full-package Expo Module bridge.  Consumers run pod install
# and get everything — they do NOT need to add SankofaIOS or GRDB.swift to
# their own Podfile.
#
# The SankofaIOS native SDK sources are embedded at install time:
#   • In monorepo development: prepare_command copies the sibling
#     sankofa_sdk_ios/Sources/SankofaIOS/ directory into ios/SankofaIOS/.
#   • When published to the CocoaPods registry: the sources are already
#     present in the pod tarball (the registry runs prepare_command before
#     packaging).
#
# GRDB.swift (>= 6.0) is available on CocoaPods trunk and satisfies the async
# read/write APIs used by SankofaQueueManager.
# ─────────────────────────────────────────────────────────────────────────────

Pod::Spec.new do |s|
  s.name           = 'SankofaReactNative'
  s.module_name    = 'SankofaReactNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.homepage       = 'https://sankofa.dev'
  s.license        = { type: 'MIT' }
  s.authors        = { 'Sankofa Team' => 'hello@sankofa.dev' }
  s.source         = { git: 'https://github.com/Sankofa-HQ/sankofa-react-native.git', tag: "v#{s.version}" }
  s.swift_version  = '5.9'
  s.platforms      = { ios: '14.0' }

  # Copy SankofaIOS sources from the sibling native SDK (monorepo) or
  # verify they are already present (published pod tarball).
  s.prepare_command = <<-CMD
    if [ -d "../sankofa_sdk_ios/Sources/SankofaIOS" ]; then
      rm -rf "ios/SankofaIOS"
      cp -R "../sankofa_sdk_ios/Sources/SankofaIOS" "ios/SankofaIOS"
      echo "[SankofaReactNative] Embedded SankofaIOS sources from sibling SDK."
    elif [ ! -d "ios/SankofaIOS" ]; then
      echo "[SankofaReactNative] ERROR: ios/SankofaIOS sources not found."
      echo "  Run pod install from the monorepo root, or ensure the"
      echo "  published pod tarball includes ios/SankofaIOS/."
      exit 1
    fi
  CMD

  # Bridge module + embedded SankofaIOS sources (all compiled in one target).
  # No `import SankofaIOS` needed — they share the same Swift module.
  s.source_files         = 'ios/**/*.{h,m,mm,swift}'
  s.private_header_files = 'ios/**/*.h'

  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'

  # GRDB.swift — SQLite-backed offline event queue used by SankofaQueueManager.
  # >= 6.0 is available on CocoaPods trunk; the async read/write APIs we use
  # were introduced in GRDB 6.0.
  s.dependency 'GRDB.swift', '>= 6.0'

  # libz — required by Data+Gzip.swift for GZIP compression of replay chunks.
  s.library = 'z'

  s.pod_target_xcconfig = {
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) EXPO_MODULES',
    'GCC_PREPROCESSOR_DEFINITIONS'        => '$(inherited) COCOAPODS=1',
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES',
    'DEFINES_MODULE'                      => 'YES'
  }

  s.frameworks = ['UIKit', 'Foundation', 'CoreGraphics', 'QuartzCore']
end
