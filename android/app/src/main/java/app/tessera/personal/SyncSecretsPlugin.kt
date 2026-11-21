package app.tessera.personal

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Secrets are encrypted with a non-exportable Android Keystore key, never put in SQLite. */
@CapacitorPlugin(name = "SyncSecrets")
class SyncSecretsPlugin : Plugin() {
    private val alias = "tessera.sync.secrets.v1"
    private val names = setOf("group-key", "mail-credentials")
    private val prefs get() = context.getSharedPreferences("tessera.sync.sealed", 0)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        val existing = store.getKey(alias, null)
        if (existing is SecretKey) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return generator.generateKey()
    }

    @PluginMethod fun store(call: PluginCall) {
        val name = call.getString("name")
        val value = call.getString("value")
        if (name !in names || value == null || value.length > 16384) {
            call.reject("invalidSyncSecret"); return
        }
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(name!!.toByteArray(Charsets.UTF_8))
            val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            val encoded = Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
            if (!prefs.edit().putString(name, encoded).commit()) throw IllegalStateException()
            call.resolve()
        } catch (_: Exception) { call.reject("secureStorageUnavailable") }
    }

    @PluginMethod fun load(call: PluginCall) {
        val name = call.getString("name")
        if (name !in names) { call.reject("invalidSyncSecret"); return }
        val encoded = prefs.getString(name, null)
        if (encoded == null) { call.resolve(JSObject().put("value", JSObject.NULL)); return }
        try {
            val data = Base64.decode(encoded, Base64.NO_WRAP)
            if (data.size < 29) throw IllegalArgumentException()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0,12)))
            cipher.updateAAD(name!!.toByteArray(Charsets.UTF_8))
            val value = String(cipher.doFinal(data.copyOfRange(12,data.size)),Charsets.UTF_8)
            call.resolve(JSObject().put("value", value))
        } catch (_: Exception) { call.reject("secureStorageUnavailable") }
    }

    @PluginMethod fun remove(call: PluginCall) {
        val name = call.getString("name")
        if (name !in names) { call.reject("invalidSyncSecret"); return }
        if (prefs.edit().remove(name).commit()) call.resolve()
        else call.reject("secureStorageUnavailable")
    }
}
