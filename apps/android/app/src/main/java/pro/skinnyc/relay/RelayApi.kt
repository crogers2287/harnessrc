package pro.skinnyc.relay

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class ApiFailure(val status: Int, message: String) : IOException(message)

class RelayApi(var base: String = DEFAULT_ENDPOINT) {
    companion object {
        const val DEFAULT_ENDPOINT = "https://fred.taile5e8a3.ts.net:11543"
    }

    val client =
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(130, TimeUnit.SECONDS)
            .callTimeout(135, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .build()

    fun request(path: String) =
        Request.Builder()
            .url(base.trimEnd('/') + path)
            .header("X-RC-Request", "1")
            .header("Origin", base.trimEnd('/'))

    suspend fun execute(request: Request): Response = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    if (continuation.isActive) continuation.resume(response) else response.close()
                }
            }
        )
    }

    suspend fun api(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val payload =
            if (method == "GET") null
            else (body?.toString() ?: "{}").toRequestBody("application/json".toMediaType())
        return jsonResponse(request(path).method(method, payload).build())
    }

    suspend fun binary(path: String, bytes: ByteArray): JSONObject =
        jsonResponse(
            request(path)
                .post(bytes.toRequestBody("application/octet-stream".toMediaType()))
                .build()
        )

    private suspend fun jsonResponse(request: Request): JSONObject =
        withContext(Dispatchers.IO) {
            execute(request).use { response ->
                val value =
                    runCatching { JSONObject(response.body?.string() ?: "{}") }
                        .getOrElse { JSONObject() }
                if (!response.isSuccessful)
                    throw ApiFailure(
                        response.code,
                        value.str("error").ifBlank { "Gateway returned ${response.code}" },
                    )
                value
            }
        }

    suspend fun bytes(path: String): ByteArray =
        withContext(Dispatchers.IO) {
            execute(request(path).build()).use { response ->
                if (!response.isSuccessful)
                    throw ApiFailure(response.code, "Could not download this file")
                response.body?.bytes() ?: byteArrayOf()
            }
        }

    fun websocket(listener: WebSocketListener): WebSocket =
        client.newWebSocket(request("/ws").build(), listener)
}
