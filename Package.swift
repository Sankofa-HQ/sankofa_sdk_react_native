// swift-tools-version: 5.9
// This Package.swift exists so the SDK can be used via SPM in pure RN/Xcode projects.
// In CocoaPods projects (Expo/RN), the SankofaReactNative.podspec is used instead.

import PackageDescription

let package = Package(
    name: "SankofaReactNative",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "SankofaReactNative", targets: ["SankofaReactNative"])
    ],
    dependencies: [
        // Consume the released SankofaIOS (a relative path only resolves
        // inside the monorepo; external SPM consumers need the published tag).
        .package(url: "https://github.com/Sankofa-HQ/sankofa_sdk_ios.git", from: "1.0.1"),
    ],
    targets: [
        .target(
            name: "SankofaReactNative",
            dependencies: [
                .product(name: "SankofaIOS", package: "sankofa_sdk_ios"),
            ],
            path: "ios"
        )
    ]
)
