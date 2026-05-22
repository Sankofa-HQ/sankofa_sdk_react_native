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
  /** SharedPreferences flag flipped to `true` on the first invocation —
   *  proves the host's MainApplication actually wired its
   *  `getJSBundleFile` override into us. `checkIntegration()` reads
   *  this to tell the host "your bundle loader patch is/isn't live."
   */
  private const val WIRED_FLAG = "bundle_loader_wired"

  @JvmStatic
  fun getJSBundleFile(context: Context): String? {
    context
      .getSharedPreferences("sankofa_deploy", Context.MODE_PRIVATE)
      .edit()
      .putBoolean(WIRED_FLAG, true)
      .apply()
    val path = context
      .getSharedPreferences("sankofa_deploy", Context.MODE_PRIVATE)
      .getString("bundle_path", null)
      ?: return null
    return if (File(path).exists()) path else null
  }
}
