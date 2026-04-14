package dev.sankofa.rn

import android.content.Context
import java.io.File

/**
 * Bundle provider for Expo prebuild/dev-client and bare React Native hosts.
 *
 * In release builds, override ReactNativeHost.getJSBundleFile() and return
 * this value when non-null:
 *
 *   override fun getJSBundleFile(): String? =
 *     SankofaDeployBundleProvider.getJSBundleFile(applicationContext)
 *       ?: super.getJSBundleFile()
 */
object SankofaDeployBundleProvider {
  @JvmStatic
  fun getJSBundleFile(context: Context): String? {
    val path = context
      .getSharedPreferences("sankofa_deploy", Context.MODE_PRIVATE)
      .getString("bundle_path", null)
      ?: return null
    return if (File(path).exists()) path else null
  }
}
