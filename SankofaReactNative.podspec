require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# ─── OSS-First SDK Configuration ──────────────────────────────────────────────
# By default, this SDK expects the 'SankofaIOS' CocoaPods artifact to be available.
#
# AUTOMATIC MONOREPO DETECTION:
# If the sibling 'sankofa_sdk_ios' folder exists, we automatically switch to
# local source mode for a seamless developer experience inside the monorepo.
# ─────────────────────────────────────────────────────────────────────────────
sankofa_ios_sources = File.join(__dir__, '..', 'sankofa_sdk_ios', 'Sources', 'SankofaIOS')
sankofa_source_sdk = (ENV['SANKOFA_SOURCE_SDK'] == '1') || Dir.exist?(sankofa_ios_sources)

Pod::Spec.new do |s|
  s.name           = 'SankofaReactNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.homepage       = 'https://sankofa.dev'
  s.license        = { type: 'MIT' }
  s.authors        = { 'Sankofa Team' => 'hello@sankofa.dev' }
  s.platforms      = { ios: '14.0' }
  s.source         = { git: 'https://github.com/Sankofa-HQ/sankofa-react-native.git' }
  s.swift_version  = '5.9'

  # ─── File & Config Definitions ───────────────────────────────────────────
  # Prepare path arrays so we can merge them cleanly based on mode.
  source_files = ['ios/**/*.{h,m,mm,swift}']
  xcconfig = {
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) EXPO_MODULES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) COCOAPODS=1'
  }

  if sankofa_source_sdk
    # ─── LOCAL DEVELOPMENT MODE ──────────────────────────────────────────────
    # Compile the sibling Swift sources directly into this target.
    source_files += ["#{sankofa_ios_sources}/**/*.{h,m,mm,swift}"]
    xcconfig['SWIFT_INCLUDE_PATHS'] = "$(PODS_TARGET_SRCROOT)/#{sankofa_ios_sources}"
  else
    # ─── PRODUCTION / OSS MODE ───────────────────────────────────────────────
    # Link against the published SankofaIOS CocoaPod.
    s.dependency 'SankofaIOS', '~> 1.0.0'
  end

  s.source_files = source_files
  s.private_header_files = 'ios/**/*.h'
  s.pod_target_xcconfig = xcconfig
  s.frameworks = ['UIKit', 'Foundation', 'CoreGraphics', 'QuartzCore']
end
