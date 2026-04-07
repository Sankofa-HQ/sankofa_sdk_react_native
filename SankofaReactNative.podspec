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
#   • In standalone installs: prepare_command clones the SankofaIOS repo
#     directly from GitHub at the pinned ref below and copies its Sources
#     into ios/SankofaIOS/.
#
# Pinning is done by branch name for now; switch to a tag once SankofaIOS
# starts cutting releases (e.g. SANKOFA_IOS_REF = 'v1.0.0').
#
# GRDB.swift (>= 6.0) is available on CocoaPods trunk and satisfies the async
# read/write APIs used by SankofaQueueManager.
# ─────────────────────────────────────────────────────────────────────────────

SANKOFA_IOS_REPO = 'https://github.com/Sankofa-HQ/sankofa_sdk_ios.git'
SANKOFA_IOS_REF  = 'main'

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

  # Embed SankofaIOS sources at install time:
  #   1. Prefer the sibling sankofa_sdk_ios/ directory (monorepo dev mode).
  #   2. Otherwise clone the repo from GitHub at the pinned ref.
  # Either way, the sources end up in ios/SankofaIOS/ and are compiled as
  # part of this pod's target — no extra entries in the consumer Podfile.
  s.prepare_command = <<-CMD
    set -e
    rm -rf "ios/SankofaIOS"
    if [ -d "../sankofa_sdk_ios/Sources/SankofaIOS" ]; then
      cp -R "../sankofa_sdk_ios/Sources/SankofaIOS" "ios/SankofaIOS"
      echo "[SankofaReactNative] Embedded SankofaIOS sources from sibling SDK."
    else
      TMP_DIR="$(mktemp -d)"
      echo "[SankofaReactNative] Cloning SankofaIOS from #{SANKOFA_IOS_REPO} (#{SANKOFA_IOS_REF})..."
      git clone --depth 1 --branch "#{SANKOFA_IOS_REF}" "#{SANKOFA_IOS_REPO}" "$TMP_DIR" >/dev/null 2>&1
      cp -R "$TMP_DIR/Sources/SankofaIOS" "ios/SankofaIOS"
      rm -rf "$TMP_DIR"
      echo "[SankofaReactNative] Embedded SankofaIOS sources from GitHub."
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
