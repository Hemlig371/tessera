package app.tessera.personal

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.hardware.biometrics.BiometricPrompt
import android.hardware.biometrics.BiometricManager
import android.os.Build
import android.os.CancellationSignal
import androidx.activity.result.ActivityResult
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.JSObject
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

/** Only an OS credential/biometric prompt. Never stores or implements a Tessera PIN. */
@CapacitorPlugin(name = "DeviceAuth")
class DeviceAuthPlugin : Plugin() {
    private val keyguard get() = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

    @PluginMethod fun available(call: PluginCall) {
        call.resolve(JSObject().put("supported", keyguard.isDeviceSecure))
    }

    @PluginMethod fun authenticate(call: PluginCall) {
        if (!keyguard.isDeviceSecure) { call.reject("authUnavailable"); return }
        activity.runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= 28) {
                    val builder = BiometricPrompt.Builder(activity).setTitle("Tessera")
                        .setSubtitle("Confirm device identity")
                    if (Build.VERSION.SDK_INT >= 30) {
                        builder.setAllowedAuthenticators(
                            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                            BiometricManager.Authenticators.DEVICE_CREDENTIAL
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        builder.setDeviceCredentialAllowed(true)
                    }
                    val prompt = builder.build()
                    prompt.authenticate(CancellationSignal(), activity.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            call.resolve()
                        }
                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            call.reject("authCancelled")
                        }
                    })
                } else {
                    @Suppress("DEPRECATION")
                    val intent = keyguard.createConfirmDeviceCredentialIntent("Tessera", "Confirm device identity")
                    if (intent == null) call.reject("authUnavailable")
                    else startActivityForResult(call, intent, "credentialResult")
                }
            } catch (_: Exception) { call.reject("authUnavailable") }
        }
    }

    @ActivityCallback
    private fun credentialResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) call.resolve()
        else call.reject("authCancelled")
    }
}
