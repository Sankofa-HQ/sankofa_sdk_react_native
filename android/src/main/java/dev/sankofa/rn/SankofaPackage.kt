package dev.sankofa.rn

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.Package

/**
 * SankofaPackage
 *
 * Registers SankofaModule with the Expo Modules system.
 * Listed in AndroidManifest.xml under expo.modules.core.ExpoModulesPackageList.
 */
class SankofaPackage : Package {
  override fun createModules(): List<Module> = listOf(SankofaModule())
}
