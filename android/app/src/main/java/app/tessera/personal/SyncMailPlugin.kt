package app.tessera.personal

import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import kotlin.concurrent.thread

/** SMTP/IMAP over system-trusted implicit TLS. Only opaque encrypted bytes enter mail bodies.
 * Never deletes mail. Credentials are used only for the active connection and never logged.
 */
@CapacitorPlugin(name = "SyncMail")
class SyncMailPlugin : Plugin() {
    private data class Account(val host:String,val port:Int,val user:String,val password:String)
    private fun account(call:PluginCall,prefix:String):Account {
        val host=call.getString(prefix+"Host") ?: throw IllegalArgumentException()
        val port=call.getInt(prefix+"Port") ?: throw IllegalArgumentException()
        val user=call.getString("user") ?: throw IllegalArgumentException()
        val password=call.getString("password") ?: throw IllegalArgumentException()
        if (!host.matches(Regex("[A-Za-z0-9.-]{1,253}")) || port !in 1..65535 ||
            user.length !in 1..254 || user.any { it=='\r' || it=='\n' } ||
            password.length !in 1..1024 || password.any { it=='\r' || it=='\n' })
            throw IllegalArgumentException()
        return Account(host,port,user,password)
    }
    private class Channel(private val socket:SSLSocket) : AutoCloseable {
        val input=BufferedInputStream(socket.inputStream)
        private val out=BufferedOutputStream(socket.outputStream)
        fun send(value:String) {
            out.write(value.toByteArray(Charsets.US_ASCII));out.flush()
        }
        fun line(max:Int=16384):String {
            val out=ByteArrayOutputStream()
            while(true) {
                val b=input.read()
                if(b<0) throw IllegalStateException("transportClosed")
                if(b==10) break
                if(out.size()>=max) throw IllegalStateException("mailLimit")
                if(b!=13) out.write(b)
            }
            return out.toString("UTF-8")
        }
        fun literal(size:Int):ByteArray {
            if(size<0 || size>4*1024*1024) throw IllegalStateException("mailLimit")
            val bytes=ByteArray(size)
            var offset=0
            while(offset<size) {
                val n=input.read(bytes,offset,size-offset)
                if(n<0) throw IllegalStateException("transportClosed")
                offset+=n
            }
            return bytes
        }
        override fun close()=socket.close()
    }
    private fun connect(account:Account):Channel {
        val plain=javax.net.Socket()
        plain.connect(InetSocketAddress(account.host,account.port),12000)
        plain.soTimeout=18000
        try {
            val ssl=SSLSocketFactory.getDefault().createSocket(plain,account.host,account.port,true) as SSLSocket
            ssl.soTimeout=18000
            ssl.startHandshake()
            return Channel(ssl)
        } catch(e:Exception){plain.close();throw e}
    }
    private fun smtpResponse(channel:Channel,code:Int):String {
        val first=channel.line()
        if(first.length<3 || first.substring(0,3).toIntOrNull()!=code) throw IllegalStateException("mailRejected")
        val text=StringBuilder(first)
        var current=first
        var count=0
        while(current.length>3 && current[3]=='-') {
            if(++count>64) throw IllegalStateException("mailLimit")
            current=channel.line()
            if(current.length<3 || current.substring(0,3).toIntOrNull()!=code) throw IllegalStateException("mailRejected")
            text.append('\n').append(current)
        }
        return text.toString()
    }
    private fun imap(channel:Channel,tag:String,cmd:String,consumer:(String,Channel)->Unit={_,_->}) {
        channel.send("$tag $cmd\r\n")
        repeat(4096) {
            val line=channel.line()
            if(line.startsWith("$tag ")) {
                if(!line.startsWith("$tag OK",ignoreCase=true)) throw IllegalStateException("mailRejected")
                return
            }
            consumer(line,channel)
        }
        throw IllegalStateException("mailLimit")
    }
    private fun encoded(value:String)=Base64.encodeToString(value.toByteArray(Charsets.UTF_8),Base64.NO_WRAP)
    private fun launch(call:PluginCall,block:()->JSObject) {
        thread(name="tessera-sync-mail") {
            try { call.resolve(block()) }
            catch (_:Exception) { call.reject("mailTransportFailed") }
        }
    }
    @PluginMethod fun send(call:PluginCall) {
        launch(call) {
            val a=account(call,"smtp")
            val address=call.getString("address") ?: throw IllegalArgumentException()
            if(!address.matches(Regex("[A-Za-z0-9.!#\$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]{1,253}"))) throw IllegalArgumentException()
            val payload=call.getString("payload") ?: throw IllegalArgumentException()
            if(payload.length>3*1024*1024 || !payload.matches(Regex("[A-Za-z0-9+/=]+"))) throw IllegalArgumentException()
            val kind=call.getString("kind") ?: throw IllegalArgumentException()
            val source=call.getString("source") ?: throw IllegalArgumentException()
            val id=call.getString("id") ?: throw IllegalArgumentException()
            val offset=call.getInt("offset") ?: -1
            if(kind !in setOf("packet","receipt","chunk") ||
                !source.matches(Regex("[0-9a-f-]{36}")) || !id.matches(Regex("[0-9a-f-]{36}")) ||
                offset < -1) throw IllegalArgumentException()
            connect(a).use { ch ->
                smtpResponse(ch,220)
                ch.send("EHLO tessera.local\r\n");smtpResponse(ch,250)
                ch.send("AUTH PLAIN "+Base64.encodeToString(
                    ("\u0000"+a.user+"\u0000"+a.password).toByteArray(Charsets.UTF_8),Base64.NO_WRAP)+"\r\n")
                smtpResponse(ch,235)
                ch.send("MAIL FROM:<$address>\r\n");smtpResponse(ch,250)
                ch.send("RCPT TO:<$address>\r\n");smtpResponse(ch,250)
                ch.send("DATA\r\n");smtpResponse(ch,354)
                val headers="From: <$address>\r\nTo: <$address>\r\nSubject: Sync data\r\n"+
                    "MIME-Version: 1.0\r\nContent-Type: application/octet-stream\r\n"+
                    "Content-Transfer-Encoding: base64\r\nX-Tessera-Wire: 1\r\n"+
                    "X-Tessera-Kind: $kind\r\nX-Tessera-Source: $source\r\n"+
                    "X-Tessera-Id: $id\r\nX-Tessera-Offset: $offset\r\n\r\n"
                ch.send(headers)
                for(i in payload.indices step 76) ch.send(payload.substring(i,minOf(payload.length,i+76))+"\r\n")
                ch.send(".\r\n");smtpResponse(ch,250)
                ch.send("QUIT\r\n")
            }
            JSObject()
        }
    }
    @PluginMethod fun fetch(call:PluginCall) {
        launch(call) {
            val a=account(call,"imap")
            val after=call.getInt("afterUid") ?: 0
            val limit=call.getInt("limit") ?: 128
            if(after<0 || limit !in 1..256) throw IllegalArgumentException()
            var validity=0L
            val messages=JSArray()
            var highestUid=after.toLong()
            connect(a).use { ch ->
                if(!ch.line().startsWith("* OK",ignoreCase=true)) throw IllegalStateException()
                // AUTHENTICATE PLAIN avoids exposing account credentials in IMAP command lines.
                ch.send("a01 AUTHENTICATE PLAIN\r\n")
                if(!ch.line().startsWith("+")) throw IllegalStateException()
                ch.send(Base64.encodeToString(("\u0000"+a.user+"\u0000"+a.password).toByteArray(Charsets.UTF_8),Base64.NO_WRAP)+"\r\n")
                var ok=false
                for(i in 0 until 64) {
                    val response=ch.line()
                    if(response.startsWith("a01 ")) {
                        ok=response.startsWith("a01 OK",true)
                        break
                    }
                }
                if(!ok) throw IllegalStateException("mailRejected")
                imap(ch,"a02","SELECT INBOX") { line,_ ->
                    val match=Regex("UIDVALIDITY (\\d+)",RegexOption.IGNORE_CASE).find(line)
                    if(match!=null) validity=match.groupValues[1].toLong()
                }
                if(validity<=0) throw IllegalStateException("mailRejected")
                val found=ArrayList<Long>()
                val start=after.toLong()+1
                imap(ch,"a03","UID SEARCH UID $start:*") { line,_ ->
                    if(line.startsWith("* SEARCH",true)) {
                        for(s in line.removePrefix("* SEARCH").trim().split(" "))
                            s.toLongOrNull()?.let { if(it>after) { found.add(it);highestUid=maxOf(highestUid,it) } }
                    }
                }
                for(uid in found.sorted().take(limit)) {
                    imap(ch,"a04","UID FETCH $uid (UID BODY.PEEK[])") { line,channel ->
                        val literalSize=Regex("\\{(\\d+)\\}$").find(line)?.groupValues?.get(1)?.toIntOrNull()
                        if(literalSize!=null) {
                            val raw=channel.literal(literalSize)
                            val mime=raw.toString(Charsets.UTF_8)
                            val split=mime.indexOf("\r\n\r\n")
                            if(split>=0) {
                                val head=mime.substring(0,split)
                                if(head.contains("X-Tessera-Wire: 1",true)) {
                                    fun field(name:String):String?=Regex("(?im)^"+Regex.escape(name)+": ([^\\r\\n]+)").find(head)?.groupValues?.get(1)?.trim()
                                    val kind=field("X-Tessera-Kind")
                                    val source=field("X-Tessera-Source")
                                    val id=field("X-Tessera-Id")
                                    val offset=field("X-Tessera-Offset")?.toIntOrNull()
                                    val data=mime.substring(split+4).replace(Regex("\\s"),"")
                                    if(kind in setOf("packet","receipt","chunk") && source!=null && id!=null &&
                                        offset!=null && data.length<=3*1024*1024 &&
                                        data.matches(Regex("[A-Za-z0-9+/=]+"))) {
                                        val row=JSObject().put("uid",uid).put("kind",kind)
                                            .put("source",source).put("id",id).put("offset",offset).put("payload",data)
                                        messages.put(row)
                                    }
                                }
                            }
                        }
                    }
                }
                ch.send("a05 LOGOUT\r\n")
            }
            JSObject().put("uidValidity",validity.toString()).put("maxUid",highestUid.toString()).put("messages",messages)
        }
    }
}
