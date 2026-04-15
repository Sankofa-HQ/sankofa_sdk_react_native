require 'json'
require 'fileutils'
require 'open3'
require 'tmpdir'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# ─────────────────────────────────────────────────────────────────────────────
# SankofaReactNative.podspec
#
# Full-package Expo Module bridge.  Consumers run pod install and get
# everything — they do NOT need to add SankofaIOS or GRDB.swift to their
# own Podfile.
#
# Source materialization runs in Ruby at podspec EVALUATION time (not as a
# `prepare_command`).  This guarantees the files exist BEFORE source_files
# is glob-resolved, on every pod install, regardless of cwd.
#
# Two-tier resolution:
#   1. Monorepo dev — copies sibling sankofa_sdk_ios/Sources/SankofaIOS/
#   2. Standalone install — git clones https://github.com/Sankofa-HQ/sankofa_sdk_ios.git
#      at the pinned ref below
# ─────────────────────────────────────────────────────────────────────────────

SANKOFA_IOS_REPO = 'https://github.com/Sankofa-HQ/sankofa_sdk_ios.git'
SANKOFA_IOS_REF  = 'main'  # switch to a tag (e.g. 'v1.0.0') once SankofaIOS cuts releases

# Materialize SankofaIOS sources into ios/SankofaIOS/ before source_files is
# glob-resolved.  Inline (not a `def`) because CocoaPods evaluates the podspec
# inside the Pod module — a top-level `def` would land on Pod, not as a free
# function.  Anchored to __dir__ so paths work regardless of invocation cwd.
sankofa_ios_dest    = File.join(__dir__, 'ios', 'SankofaIOS')
sankofa_ios_sibling = File.expand_path('../sankofa_sdk_ios/Sources/SankofaIOS', __dir__)

FileUtils.rm_rf(sankofa_ios_dest)

if File.directory?(sankofa_ios_sibling)
  FileUtils.cp_r(sankofa_ios_sibling, sankofa_ios_dest)
  Pod::UI.message "[SankofaReactNative] Embedded SankofaIOS from sibling SDK" if defined?(Pod::UI)
else
  Pod::UI.message "[SankofaReactNative] Cloning SankofaIOS from #{SANKOFA_IOS_REPO} (#{SANKOFA_IOS_REF})..." if defined?(Pod::UI)
  Dir.mktmpdir do |tmp|
    out, status = Open3.capture2e(
      'git', 'clone', '--depth', '1', '--branch', SANKOFA_IOS_REF,
      SANKOFA_IOS_REPO, tmp
    )
    raise "[SankofaReactNative] git clone failed:\n#{out}" unless status.success?

    src = File.join(tmp, 'Sources', 'SankofaIOS')
    raise "[SankofaReactNative] Sources/SankofaIOS not found in cloned repo" unless File.directory?(src)

    FileUtils.cp_r(src, sankofa_ios_dest)
  end
  Pod::UI.message "[SankofaReactNative] Embedded SankofaIOS from GitHub" if defined?(Pod::UI)
end

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

  # Bridge module + materialized SankofaIOS sources (all compiled in one target).
  # No `import SankofaIOS` needed — they share the same Swift module.
  s.source_files         = 'ios/**/*.{h,m,mm,swift}'
  s.private_header_files = 'ios/**/*.h'

  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'

  # GRDB.swift — SQLite-backed offline event queue used by SankofaQueueManager.
  # >= 6.0 is available on CocoaPods trunk; the async read/write APIs we use
  # were introduced in GRDB 6.0.
  s.dependency 'GRDB.swift', '>= 6.0'

  # SSZipArchive — battle-tested zip extractor used by Sankofa Deploy to unpack
  # OTA archives (bundle.jsbundle + assets/) into the app's data container.
  s.dependency 'SSZipArchive', '~> 2.4'

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
