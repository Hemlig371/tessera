package app.tessera.personal

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import java.io.ByteArrayOutputStream
import java.io.File

/** Dedicated trusted-device QR exchange. Camera JPEG is temporary and removed after decoding. */
@CapacitorPlugin(name = "SyncQr")
class SyncQrPlugin : Plugin() {
    private var photo:File?=null
    private var capturing=false

    @PluginMethod fun render(call:PluginCall) {
        val value=call.getString("value")
        if(value==null || value.length !in 1..512) {call.reject("invalidSyncInvitation");return}
        try {
            val matrix=QRCodeWriter().encode(value,BarcodeFormat.QR_CODE,640,640)
            val pixels=IntArray(640*640)
            for(y in 0 until 640)for(x in 0 until 640)
                pixels[y*640+x]=if(matrix.get(x,y)) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            val bitmap=Bitmap.createBitmap(pixels,640,640,Bitmap.Config.ARGB_8888)
            val stream=ByteArrayOutputStream()
            if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,stream)) throw IllegalStateException()
            bitmap.recycle()
            val image=Base64.encodeToString(stream.toByteArray(),Base64.NO_WRAP)
            call.resolve(JSObject().put("image","data:image/png;base64,$image"))
        } catch (_:Exception) {call.reject("qrRenderFailed")}
    }
    @PluginMethod fun scan(call:PluginCall) {
        if(capturing) {call.reject("qrBusy");return}
        try {
            val file=File.createTempFile("tessera-qr-", ".jpg", context.cacheDir)
            val uri=FileProvider.getUriForFile(context,context.packageName+".fileprovider",file)
            photo=file
            capturing=true
            val intent=Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT,uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                clipData=ClipData.newRawUri("QR",uri)
            }
            startActivityForResult(call,intent,"captured")
        } catch (_:Exception) {discard();call.reject("qrUnavailable")}
    }
    @ActivityCallback private fun captured(call:PluginCall?,result:ActivityResult) {
        if(call==null) {discard();return}
        try {
            if(result.resultCode!=Activity.RESULT_OK) {
                call.resolve(JSObject().put("cancelled",true));return
            }
            val file=photo ?: throw IllegalStateException()
            val bounds=BitmapFactory.Options().apply {inJustDecodeBounds=true}
            BitmapFactory.decodeFile(file.absolutePath,bounds)
            if(bounds.outWidth<=0 || bounds.outHeight<=0 || bounds.outWidth>10000 || bounds.outHeight>10000)
                throw IllegalStateException()
            val maxOfDimensions=maxOf(bounds.outWidth,bounds.outHeight)
            var scale=1
            while(maxOfDimensions/scale>1800)scale*=2
            val bitmap=BitmapFactory.decodeFile(file.absolutePath,BitmapFactory.Options().apply {inSampleSize=scale})
                ?:throw IllegalStateException()
            val pixels=IntArray(bitmap.width*bitmap.height)
            bitmap.getPixels(pixels,0,bitmap.width,0,0,bitmap.width,bitmap.height)
            val luminance=RGBLuminanceSource(bitmap.width,bitmap.height,pixels)
            bitmap.recycle()
            val data=QRCodeReader().decode(BinaryBitmap(HybridBinarizer(luminance))).text
            if(data.length>512) throw IllegalStateException()
            call.resolve(JSObject().put("cancelled",false).put("value",data))
        } catch (_:Exception) {call.reject("qrScanFailed")}
        finally {discard()}
    }
    private fun discard() {
        capturing=false
        photo?.delete()
        photo=null
    }
    override fun handleOnDestroy(){discard()}
}
