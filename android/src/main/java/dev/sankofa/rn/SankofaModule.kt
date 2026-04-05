package dev.sankofa.rn

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

  override fun definition() = ModuleDefinition {
    Name("Sankofa")

    // ── initialize ──────────────────────────────────────────────────────────
    Function("initialize") { apiKey: String, config: Map<String, Any?> ->
      val ctx = appContext.reactContext?.applicationContext ?: return@Function
      val sdkConfig = SankofaConfig(
        endpoint            = config["endpoint"] as? String ?: "https://api.sankofa.dev",
        debug               = config["debug"] as? Boolean ?: false,
        trackLifecycleEvents= config["trackLifecycleEvents"] as? Boolean ?: true,
        recordSessions      = config["recordSessions"] as? Boolean ?: true,
        maskAllInputs       = config["maskAllInputs"] as? Boolean ?: true,
        flushIntervalSeconds= (config["flushIntervalSeconds"] as? Number)?.toInt() ?: 30,
        batchSize           = (config["batchSize"] as? Number)?.toInt() ?: 50,
      )
      Sankofa.init(context = ctx, apiKey = apiKey, config = sdkConfig)
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
