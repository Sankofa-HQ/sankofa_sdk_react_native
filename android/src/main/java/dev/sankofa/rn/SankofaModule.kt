package dev.sankofa.rn

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import dev.sankofa.sdk.Sankofa
import dev.sankofa.sdk.SankofaConfig

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
  }
}
