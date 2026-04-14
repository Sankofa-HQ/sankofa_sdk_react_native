package dev.sankofa.rn

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import dev.sankofa.sdk.Sankofa
import dev.sankofa.sdk.SankofaConfig
import java.io.File
import java.io.FileOutputStream
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.GZIPInputStream

/**
 * SankofaModule
 *
 * Expo Module that bridges the Sankofa React Native JS API to the native
 * Android Sankofa SDK (`dev.sankofa.sdk.Sankofa`).
 *
 * Registered automatically via SankofaPackage → ExpoModulesPackageList.
 */
class SankofaModule : Module() {

  private val mainHandler = Handler(Looper.getMainLooper())

  private fun deployPrefs(ctx: Context) =
    ctx.getSharedPreferences("sankofa_deploy", Context.MODE_PRIVATE)

  private fun requireApplicationContext(): Context? =
    appContext.reactContext?.applicationContext

  private fun sanitizeFilePart(value: String): String =
    value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(96).ifBlank { "bundle" }

  private fun isGzip(file: File): Boolean =
    file.inputStream().use { input ->
      input.read() == 0x1f && input.read() == 0x8b
    }

  private inline fun runOnMain(crossinline block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block()
    else mainHandler.post { block() }
  }

  override fun definition() = ModuleDefinition {
    Name("Sankofa")

    // ── initialize ──────────────────────────────────────────────────────────
    // Sankofa.init() registers a ProcessLifecycleOwner observer, which the
    // androidx.lifecycle library requires to be called on the main thread.
    // Expo Module Function {} blocks run on the JS/module thread, so we must
    // dispatch to the main looper. (This mirrors the iOS bridge's
    // DispatchQueue.main.async wrapper.)
    Function("initialize") { apiKey: String, config: Map<String, Any?> ->
      val ctx = appContext.reactContext?.applicationContext ?: run {
        android.util.Log.w("SankofaModule", "Sankofa: applicationContext unavailable — initialize() skipped.")
        return@Function
      }
      val sdkConfig = SankofaConfig(
        endpoint            = config["endpoint"] as? String ?: "https://api.sankofa.dev",
        debug               = config["debug"] as? Boolean ?: false,
        trackLifecycleEvents= config["trackLifecycleEvents"] as? Boolean ?: true,
        recordSessions      = config["recordSessions"] as? Boolean ?: true,
        maskAllInputs       = config["maskAllInputs"] as? Boolean ?: true,
        flushIntervalSeconds= (config["flushIntervalSeconds"] as? Number)?.toInt() ?: 30,
        batchSize           = (config["batchSize"] as? Number)?.toInt() ?: 50,
      )
      runOnMain {
        Sankofa.init(context = ctx, apiKey = apiKey, config = sdkConfig)
      }
    }

    // ── screen ───────────────────────────────────────────────────────────────
    Function("screen") { name: String, properties: Map<String, Any?>? ->
      @Suppress("UNCHECKED_CAST")
      val props = properties?.filterValues { it != null } as? Map<String, Any> ?: emptyMap()
      Sankofa.screen(name, props)
    }

    // ── track ────────────────────────────────────────────────────────────────
    Function("track") { event: String, properties: Map<String, Any?>? ->
      @Suppress("UNCHECKED_CAST")
      val props = properties?.filterValues { it != null } as? Map<String, Any> ?: emptyMap()
      Sankofa.track(event, props)
    }

    // ── identify ─────────────────────────────────────────────────────────────
    Function("identify") { userId: String ->
      Sankofa.identify(userId)
    }

    // ── setPerson ────────────────────────────────────────────────────────────
    Function("setPerson") { traits: Map<String, Any?> ->
      Sankofa.setPerson(
        name   = traits["name"] as? String,
        email  = traits["email"] as? String,
        avatar = traits["avatar"] as? String,
        properties = traits
          .filterKeys { it !in listOf("name", "email", "avatar") }
          .filterValues { it != null }
          .let {
            @Suppress("UNCHECKED_CAST")
            it as Map<String, Any>
          },
      )
    }

    // ── reset ────────────────────────────────────────────────────────────────
    Function("reset") {
      Sankofa.reset()
    }

    // ── flush ────────────────────────────────────────────────────────────────
    Function("flush") {
      Sankofa.flush()
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DEPLOY — OTA bundle download, verify, and reload
    // ═══════════════════════════════════════════════════════════════════════

    // ── deployDownloadBundle ────────────────────────────────────────────
    // Downloads a gzipped JS bundle from the given URL, decompresses it,
    // verifies the SHA256 hash, and saves it to the app's internal
    // storage. Returns the local file path on success.
    AsyncFunction("deployDownloadBundle") { url: String, expectedSha256: String, label: String, promise: Promise ->
      Thread {
        try {
          val ctx = requireApplicationContext()
          if (ctx == null) {
            promise.reject("ERR_NO_CONTEXT", "Application context unavailable", null)
            return@Thread
          }

          val deployDir = File(ctx.filesDir, "sankofa_deploy")
          deployDir.mkdirs()
          val tempFile = File(deployDir, "bundle_temp.jsbundle.gz")
          val finalFile = File(deployDir, "${sanitizeFilePart(label)}_${expectedSha256.take(12)}.jsbundle")

          // 1. Download to temp file
          val connection = URL(url).openConnection()
          connection.connectTimeout = 30_000
          connection.readTimeout = 60_000
          connection.getInputStream().use { input ->
            FileOutputStream(tempFile).use { output ->
              input.copyTo(output)
            }
          }

          // 2. Decompress gzip if needed → final file. Some HTTP stacks
          // transparently decode Content-Encoding, so plain JS is valid here.
          if (isGzip(tempFile)) {
            GZIPInputStream(tempFile.inputStream()).use { gzipIn ->
              FileOutputStream(finalFile).use { output ->
                gzipIn.copyTo(output)
              }
            }
          } else {
            tempFile.inputStream().use { input ->
              FileOutputStream(finalFile).use { output ->
                input.copyTo(output)
              }
            }
          }
          tempFile.delete()

          // 3. Verify SHA256
          val digest = MessageDigest.getInstance("SHA-256")
          finalFile.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
              digest.update(buffer, 0, bytesRead)
            }
          }
          val actualHash = digest.digest().joinToString("") { "%02x".format(it) }

          if (actualHash != expectedSha256) {
            finalFile.delete()
            promise.reject("ERR_HASH_MISMATCH", "SHA256 mismatch: expected=$expectedSha256 actual=$actualHash", null)
            return@Thread
          }

          promise.resolve(finalFile.absolutePath)
        } catch (e: Exception) {
          promise.reject("ERR_DOWNLOAD", "Bundle download failed: ${e.message}", e)
        }
      }.start()
    }

    // ── deployGetBundlePath ─────────────────────────────────────────────
    // Returns the path of the currently-installed OTA bundle, or null
    // if no OTA bundle has been applied (app uses the embedded bundle).
    Function("deployGetBundlePath") {
      val ctx = requireApplicationContext() ?: return@Function null
      val path = deployPrefs(ctx)
        .getString("bundle_path", null)
      if (path != null && File(path).exists()) path else null
    }

    // ── deploySetBundlePath ────────────────────────────────────────────
    // Marks a verified bundle as active for the native host bundle loader.
    Function("deploySetBundlePath") { path: String ->
      val ctx = requireApplicationContext() ?: return@Function null
      val file = File(path)
      if (!file.exists()) {
        throw IllegalArgumentException("Bundle file does not exist: $path")
      }
      deployPrefs(ctx).edit().putString("bundle_path", file.absolutePath).apply()
    }

    // ── deployClearBundle ────────────────────────────────────────────────
    // Deletes the OTA bundle and resets to the embedded bundle.
    // Used by the auto-rollback state machine.
    Function("deployClearBundle") {
      val ctx = requireApplicationContext() ?: return@Function null
      val prefs = deployPrefs(ctx)
      val path = prefs.getString("bundle_path", null)
      if (path != null) {
        File(path).delete()
      }
      prefs.edit().remove("bundle_path").apply()
    }

    // ── deployReload ────────────────────────────────────────────────────
    // Triggers a JS bundle reload. Uses Expo Updates if available,
    // otherwise falls back to DevSettings.reload().
    Function("deployReload") {
      runOnMain {
        try {
          // Try Expo Updates first
          val updatesClass = Class.forName("expo.modules.updates.UpdatesController")
          val instance = updatesClass.getMethod("getInstance").invoke(null)
          updatesClass.getMethod("relaunchReactApplication", android.content.Context::class.java)
            .invoke(instance, appContext.reactContext)
        } catch (e: Exception) {
          // Fallback: DevSettings reload
          try {
            appContext.currentActivity?.recreate()
          } catch (_: Exception) {}
        }
      }
    }

    // ── deploy native metadata and persistent storage ───────────────────
    Function("deployGetAppVersion") {
      val ctx = requireApplicationContext() ?: return@Function "1.0.0"
      @Suppress("DEPRECATION")
      val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
      info.versionName ?: "1.0.0"
    }

    Function("deployGetDistinctId") {
      val ctx = requireApplicationContext() ?: return@Function null
      val identityPrefs = ctx.getSharedPreferences("sankofa_identity", Context.MODE_PRIVATE)
      val identified = identityPrefs.getString("sankofa_user_id", null)
      if (!identified.isNullOrBlank()) return@Function identified
      val anonymous = identityPrefs.getString("sankofa_anon_id", null)
      if (!anonymous.isNullOrBlank()) return@Function anonymous

      val prefs = deployPrefs(ctx)
      val existing = prefs.getString("deploy_distinct_id", null)
      if (!existing.isNullOrBlank()) return@Function existing
      val generated = "deploy_${UUID.randomUUID()}"
      prefs.edit().putString("deploy_distinct_id", generated).apply()
      generated
    }

    Function("deployGetDeviceInfo") {
      mapOf(
        "osVersion" to Build.VERSION.RELEASE,
        "deviceModel" to listOf(Build.MANUFACTURER, Build.MODEL)
          .filter { it.isNotBlank() }
          .joinToString(" ")
      )
    }

    Function("deployStorageGet") { key: String ->
      val ctx = requireApplicationContext() ?: return@Function null
      deployPrefs(ctx).getString(key, null)
    }

    Function("deployStorageSet") { key: String, value: String ->
      val ctx = requireApplicationContext() ?: return@Function null
      deployPrefs(ctx).edit().putString(key, value).apply()
    }

    Function("deployStorageRemove") { key: String ->
      val ctx = requireApplicationContext() ?: return@Function null
      deployPrefs(ctx).edit().remove(key).apply()
    }

    Function("deployStorageMultiRemove") { keys: List<String> ->
      val ctx = requireApplicationContext() ?: return@Function null
      val edit = deployPrefs(ctx).edit()
      keys.forEach { edit.remove(it) }
      edit.apply()
    }
  }
}
