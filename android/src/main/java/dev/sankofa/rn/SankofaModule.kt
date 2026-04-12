package dev.sankofa.rn

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
    AsyncFunction("deployDownloadBundle") { url: String, expectedSha256: String, promise: Promise ->
      Thread {
        try {
          val ctx = appContext.reactContext?.applicationContext
          if (ctx == null) {
            promise.reject("ERR_NO_CONTEXT", "Application context unavailable", null)
            return@Thread
          }

          val deployDir = File(ctx.filesDir, "sankofa_deploy")
          deployDir.mkdirs()
          val tempFile = File(deployDir, "bundle_temp.jsbundle.gz")
          val finalFile = File(deployDir, "bundle.jsbundle")

          // 1. Download to temp file
          val connection = URL(url).openConnection()
          connection.connectTimeout = 30_000
          connection.readTimeout = 60_000
          connection.getInputStream().use { input ->
            FileOutputStream(tempFile).use { output ->
              input.copyTo(output)
            }
          }

          // 2. Decompress gzip → final file
          GZIPInputStream(tempFile.inputStream()).use { gzipIn ->
            FileOutputStream(finalFile).use { output ->
              gzipIn.copyTo(output)
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

          // 4. Save the path for the bundle loader to pick up on next reload
          ctx.getSharedPreferences("sankofa_deploy", 0)
            .edit()
            .putString("bundle_path", finalFile.absolutePath)
            .apply()

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
      val ctx = appContext.reactContext?.applicationContext ?: return@Function null
      val path = ctx.getSharedPreferences("sankofa_deploy", 0)
        .getString("bundle_path", null)
      if (path != null && File(path).exists()) path else null
    }

    // ── deployClearBundle ────────────────────────────────────────────────
    // Deletes the OTA bundle and resets to the embedded bundle.
    // Used by the auto-rollback state machine.
    Function("deployClearBundle") {
      val ctx = appContext.reactContext?.applicationContext ?: return@Function
      val prefs = ctx.getSharedPreferences("sankofa_deploy", 0)
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
            val devSettings = Class.forName("com.facebook.react.devsupport.DevInternalSettings")
            val reactContext = appContext.reactContext
            if (reactContext is com.facebook.react.bridge.ReactContext) {
              val catalyst = reactContext.catalystInstance
              catalyst?.javaClass?.getMethod("loadScriptFromFile", String::class.java, String::class.java, Boolean::class.java)
            }
          } catch (_: Exception) {}
          // Ultimate fallback: recreate the activity
          val activity = appContext.currentActivity
          activity?.recreate()
        }
      }
    }
  }
}
