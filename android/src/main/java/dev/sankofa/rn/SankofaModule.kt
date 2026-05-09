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
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

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
      // Catch (Crashlytics + Sentry merged) — forwarded into SankofaConfig
      // so the parent SDK's auto-start path is the single boot point.
      // The bridge no longer calls `SankofaCatch.init(...)` directly; that
      // path used to double-install the ANR watcher + flusher when the
      // JS layer also called `Sankofa.initialize`.
      val sdkConfig = SankofaConfig(
        endpoint            = config["endpoint"] as? String ?: "https://api.sankofa.dev",
        debug               = config["debug"] as? Boolean ?: false,
        trackLifecycleEvents= config["trackLifecycleEvents"] as? Boolean ?: true,
        recordSessions      = config["recordSessions"] as? Boolean ?: true,
        maskAllInputs       = config["maskAllInputs"] as? Boolean ?: true,
        flushIntervalSeconds= (config["flushIntervalSeconds"] as? Number)?.toInt() ?: 30,
        batchSize           = (config["batchSize"] as? Number)?.toInt() ?: 50,
        enableCatch         = config["enableCatch"] as? Boolean ?: true,
        catchEnvironment    = config["catchEnvironment"] as? String ?: "live",
        release             = config["catchRelease"] as? String,
        appVersion          = config["catchAppVersion"] as? String,
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
    // Downloads an OTA archive (zip of bundle.jsbundle + assets/), verifies
    // SHA256 against the downloaded bytes, unzips into a per-release
    // directory, and returns the absolute path to bundle.jsbundle inside it.
    // RN's AssetSourceResolver resolves `assets/...` relative to the bundle
    // URL's directory, so fonts/images load correctly without custom asset
    // wiring.
    AsyncFunction("deployDownloadBundle") { url: String, expectedSha256: String, label: String, promise: Promise ->
      Thread {
        try {
          val ctx = requireApplicationContext()
          if (ctx == null) {
            promise.reject("ERR_NO_CONTEXT", "Application context unavailable", null)
            return@Thread
          }

          val deployRoot = File(ctx.filesDir, "SankofaDeploy")
          deployRoot.mkdirs()
          val releaseDirName = "${sanitizeFilePart(label)}_${expectedSha256.take(12)}"
          val releaseDir = File(deployRoot, releaseDirName)
          val tempArchive = File(deployRoot, "$releaseDirName.download.zip")

          // 1. Download archive
          val connection = URL(url).openConnection()
          connection.connectTimeout = 30_000
          connection.readTimeout = 60_000
          connection.getInputStream().use { input ->
            FileOutputStream(tempArchive).use { output ->
              input.copyTo(output)
            }
          }

          // 2. Verify SHA256 of the downloaded bytes (matches CLI's hash)
          val digest = MessageDigest.getInstance("SHA-256")
          tempArchive.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
              digest.update(buffer, 0, bytesRead)
            }
          }
          val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
          if (actualHash != expectedSha256) {
            tempArchive.delete()
            promise.reject("ERR_HASH_MISMATCH", "Archive SHA256 mismatch: expected=$expectedSha256 actual=$actualHash", null)
            return@Thread
          }

          // 3. Unzip into a fresh release dir. Wipe any prior copy first so a
          //    re-download can't pick up stale files.
          if (releaseDir.exists()) {
            releaseDir.deleteRecursively()
          }
          releaseDir.mkdirs()
          val canonicalReleaseDir = releaseDir.canonicalPath
          ZipInputStream(tempArchive.inputStream()).use { zip ->
            var entry: ZipEntry? = zip.nextEntry
            while (entry != null) {
              val outFile = File(releaseDir, entry.name)
              // Defend against zip-slip: refuse entries that resolve outside
              // the release directory.
              if (!outFile.canonicalPath.startsWith(canonicalReleaseDir + File.separator) &&
                  outFile.canonicalPath != canonicalReleaseDir) {
                throw SecurityException("Refusing zip-slip entry: ${entry.name}")
              }
              if (entry.isDirectory) {
                outFile.mkdirs()
              } else {
                outFile.parentFile?.mkdirs()
                FileOutputStream(outFile).use { output -> zip.copyTo(output) }
              }
              zip.closeEntry()
              entry = zip.nextEntry
            }
          }
          tempArchive.delete()

          val bundleFile = File(releaseDir, "bundle.jsbundle")
          if (!bundleFile.exists()) {
            releaseDir.deleteRecursively()
            promise.reject("ERR_BUNDLE_MISSING", "Archive did not contain bundle.jsbundle", null)
            return@Thread
          }

          promise.resolve(bundleFile.absolutePath)
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
        // Delete the parent release dir (bundle + assets), not just the file.
        val bundleFile = File(path)
        val parent = bundleFile.parentFile
        if (parent != null && parent.path.contains("/SankofaDeploy/")) {
          parent.deleteRecursively()
        } else {
          bundleFile.delete()
        }
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
      val ctx = requireApplicationContext() ?: return@Function ""
      @Suppress("DEPRECATION")
      val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
      info.versionName ?: ""
    }

    /**
     * Bridge accessor for the active replay session id. Returns
     * the empty string when there's no recording (replay sampled
     * out, recordSessions=false, or pre-handshake); the JS layer
     * maps that to omitting the field rather than sending "" so
     * the wire shape distinguishes "no replay" from "replay
     * session unknown".
     */
    Function("getReplaySessionId") {
      Sankofa.replaySessionId() ?: ""
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
      // BCP-47 language tag so the server-side rules engine sees a canonical
      // value regardless of Android API level.
      val locale = try {
        val ctx = requireApplicationContext()
        if (ctx != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
          ctx.resources.configuration.locales[0].toLanguageTag()
        } else {
          java.util.Locale.getDefault().toLanguageTag()
        }
      } catch (e: Exception) {
        java.util.Locale.getDefault().toLanguageTag()
      }
      mapOf(
        "osVersion" to Build.VERSION.RELEASE,
        "deviceModel" to listOf(Build.MANUFACTURER, Build.MODEL)
          .filter { it.isNotBlank() }
          .joinToString(" "),
        "locale" to locale
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
