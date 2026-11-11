package art.wasteland.client

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors

/**
 * Multi-device Touch Capture Accessibility Service (Kotlin)
 * - Captures gestures accurately across all apps
 * - Dispatches to user-configured server URL if provided, otherwise runs locally
 */
class TouchCaptureAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var isServiceActive: Boolean = false

        @Volatile
        var activeTouchUrl: String = ""

        fun getUniqueDeviceId(ctx: android.content.Context): String {
            return try {
                val aid = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
                if (!aid.isNullOrBlank()) "node-${aid.takeLast(6)}" else "node-default"
            } catch (_: Exception) {
                "node-default"
            }
        }

        fun normalizeTouchUrl(rawUrl: String): String {
            val trimmed = rawUrl.trim()
            if (trimmed.isEmpty()) return ""
            var u = trimmed
            if (!u.startsWith("http://") && !u.startsWith("https://")) {
                u = "https://$u"
            }
            if (!u.contains("/ingest")) {
                u = u.trimEnd('/') + "/ingest?room=main"
            }
            return u
        }
    }

    private val localEventBuffer = ConcurrentLinkedQueue<JSONObject>()
    private val networkExecutor = Executors.newFixedThreadPool(2)
    private val handler = Handler(Looper.getMainLooper())
    private var screenWidth = 1080
    private var screenHeight = 2400
    private var deviceId = "node-default"

    private val flushTask = object : Runnable {
        override fun run() {
            flushBatch()
            handler.postDelayed(this, 45L)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceActive = true
        deviceId = getUniqueDeviceId(this)
        activeTouchUrl = PrefManager.getTouchUrl(this)
        updateScreenSize()
        handler.post(flushTask)
    }

    @Suppress("DEPRECATION")
    private fun updateScreenSize() {
        try {
            val wm = getSystemService(WINDOW_SERVICE) as? WindowManager ?: return
            val dm = DisplayMetrics()
            wm.defaultDisplay.getRealMetrics(dm)
            screenWidth = dm.widthPixels.coerceAtLeast(1)
            screenHeight = dm.heightPixels.coerceAtLeast(1)
        } catch (_: Exception) {}
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        try {
            val src = event.source ?: return
            val rect = Rect()
            src.getBoundsInScreen(rect)
            val cx = rect.exactCenterX()
            val cy = rect.exactCenterY()

            if (cx <= 5f && cy <= 5f) return

            if (cx > 0f && cy > 0f) {
                val action = when (event.eventType) {
                    AccessibilityEvent.TYPE_VIEW_CLICKED,
                    AccessibilityEvent.TYPE_VIEW_LONG_CLICKED -> "down"
                    else -> "move"
                }

                // 提取用户点击/聚焦位置的文字或短语 (用于大屏 30s 随机浮现)
                var extractedText: String? = null
                if (action == "down") {
                    val rawText = src.text?.toString() ?: src.contentDescription?.toString()
                    if (!rawText.isNullOrBlank()) {
                        extractedText = rawText.trim().take(48)
                    } else if (event.text != null && event.text.isNotEmpty()) {
                        val joined = event.text.joinToString(" ").trim()
                        if (joined.isNotBlank()) extractedText = joined.take(48)
                    }
                }

                enqueuePoint(cx, cy, action, extractedText)
            }

            if (event.eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
                for (i in 1..4) {
                    val jx = (cx + (Math.random() - 0.5) * 60).toFloat().coerceIn(10f, screenWidth - 10f)
                    val jy = (cy - i * 38f).coerceIn(10f, screenHeight - 10f)
                    enqueuePoint(jx, jy, "move")
                }
            }
        } catch (_: Exception) {}
    }

    private fun enqueuePoint(rawX: Float, rawY: Float, action: String, text: String? = null) {
        val nx = (rawX / screenWidth).coerceIn(0.01f, 0.99f)
        val ny = (rawY / screenHeight).coerceIn(0.01f, 0.99f)
        val obj = JSONObject().apply {
            put("nx", nx.toDouble())
            put("ny", ny.toDouble())
            put("action", action)
            if (!text.isNullOrBlank()) {
                put("text", text)
            }
            put("ts", System.currentTimeMillis())
        }
        localEventBuffer.offer(obj)

        while (localEventBuffer.size > 200) {
            localEventBuffer.poll()
        }
    }

    private fun flushBatch() {
        val targetUrl = activeTouchUrl
        if (targetUrl.isBlank() || localEventBuffer.isEmpty()) return

        val arr = JSONArray()
        while (arr.length() < 35) {
            val ev = localEventBuffer.poll() ?: break
            arr.put(ev)
        }
        if (arr.length() == 0) return

        val normalizedEndpoint = normalizeTouchUrl(targetUrl)

        networkExecutor.execute {
            var conn: HttpURLConnection? = null
            try {
                val payload = JSONObject().apply {
                    put("type", "touch_batch")
                    put("deviceId", deviceId)
                    put("screenWidth", screenWidth)
                    put("screenHeight", screenHeight)
                    put("events", arr)
                }
                val bytes = payload.toString().toByteArray(Charsets.UTF_8)
                conn = (URL(normalizedEndpoint).openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 4000
                    readTimeout = 4000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("X-Device-Id", deviceId)
                }
                conn.outputStream.use { it.write(bytes) }
                conn.responseCode
            } catch (_: Exception) {
            } finally {
                conn?.disconnect()
            }
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        isServiceActive = false
        handler.removeCallbacks(flushTask)
        networkExecutor.shutdownNow()
        localEventBuffer.clear()
        super.onDestroy()
    }
}
