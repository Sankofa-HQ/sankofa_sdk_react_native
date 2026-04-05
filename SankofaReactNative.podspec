require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Absolute path to the SankofaIOS Swift sources (sibling SDK in the monorepo).
# The files are compiled directly into this pod — no separate SPM/pod dependency needed.
sankofa_ios_sources = File.join(__dir__, '..', 'sankofa_sdk_ios', 'Sources', 'SankofaIOS')

Pod::Spec.new do |s|
  s.name           = 'SankofaReactNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.homepage       = 'https://sankofa.dev'
  s.license        = { type: 'MIT' }
  s.authors        = { 'Sankofa Team' => 'hello@sankofa.dev' }
  s.platforms      = { ios: '14.0' }
  s.source         = { git: '' }
  s.swift_version  = '5.9'

  # Bridge files + the entire SankofaIOS SDK sources compiled together.
  # This pattern avoids SPM ↔ CocoaPods interop complexity in a local monorepo.
  s.source_files = [
    'ios/**/*.{h,m,mm,swift}',
    "#{sankofa_ios_sources}/**/*.{h,m,mm,swift}",
  ]

  # Private headers referenced by SankofaIOS replay internals
  s.private_header_files = 'ios/**/*.h'

  # Standard Apple frameworks used by SankofaIOS
  s.frameworks = ['UIKit', 'Foundation', 'CoreGraphics', 'QuartzCore']

  # ExpoModulesCore provides Module, ModuleDefinition, etc.
  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) EXPO_MODULES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) COCOAPODS=1',
    # Ensure SankofaIOS sources can resolve their own imports
    'SWIFT_INCLUDE_PATHS' => "$(PODS_TARGET_SRCROOT)/#{sankofa_ios_sources}",
  }
end
