require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# ─── OSS-First SDK Configuration ──────────────────────────────────────────────
# By default, this SDK expects the 'SankofaIOS' CocoaPods artifact to be available.
#
# AUTOMATIC MONOREPO DETECTION:
# If the sibling 'sankofa_sdk_ios' folder exists, we automatically switch to
# local source mode for a seamless developer experience inside the monorepo.
# ─────────────────────────────────────────────────────────────────────────────
sankofa_ios_rel_path = '../sankofa_sdk_ios/Sources/SankofaIOS'
sankofa_ios_sources = File.expand_path(sankofa_ios_rel_path, __dir__)
sankofa_source_sdk = (ENV['SANKOFA_SOURCE_SDK'] == '1') || Dir.exist?(sankofa_ios_sources)

Pod::Spec.new do |s|
  s.name           = 'SankofaReactNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.homepage       = 'https://sankofa.dev'
  s.license        = { type: 'MIT' }
  s.authors        = { 'Sankofa Team' => 'hello@sankofa.dev' }
  s.platforms      = { ios: '14.0' }
  s.source         = { git: 'https://github.com/Sankofa-HQ/sankofa-react-native.git', tag: "v#{s.version}" }
  s.swift_version  = '5.9'

  # ─── File & Config Definitions ───────────────────────────────────────────
  source_files = ['ios/**/*.{h,m,mm,swift}']
  
  # Local config map to avoid Ruby DSL issues with s.pod_target_xcconfig
  xcconfig_map = {
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) EXPO_MODULES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) COCOAPODS=1',
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES',
    'DEFINES_MODULE' => 'YES'
  }

  # Required React Native & Expo dependencies
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'

  # Core SankofaIOS dependencies mapped into the React Native SDK
  s.dependency 'GRDB.swift', '>= 6.0'
  s.library = 'z'

  s.prepare_command = <<-CMD
    if [ -d "../sankofa_sdk_ios/Sources/SankofaIOS" ]; then
      rm -rf "ios/SankofaIOS"
      cp -R "../sankofa_sdk_ios/Sources/SankofaIOS" "ios"
    fi
  CMD

  if sankofa_source_sdk
    # ─── LOCAL DEVELOPMENT MODE ──────────────────────────────────────────────
    # Compile the sibling Swift sources directly into this target.
    source_files += ["ios/SankofaIOS/**/*.{h,m,mm,swift}"]
    
    # Merge local source include paths
    xcconfig_map['SWIFT_INCLUDE_PATHS'] = "$(PODS_TARGET_SRCROOT)/ios/SankofaIOS"
  else
    # ─── PRODUCTION / OSS MODE ───────────────────────────────────────────────
    # Link against the published SankofaIOS CocoaPod.
    s.dependency 'SankofaIOS', '~> 1.0.0'
  end

  # Assign finalized attributes
  s.source_files = source_files
  s.private_header_files = 'ios/**/*.h'
  s.pod_target_xcconfig = xcconfig_map
  s.frameworks = ['UIKit', 'Foundation', 'CoreGraphics', 'QuartzCore']
end
