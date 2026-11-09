package art.wasteland.client

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Local Touch Capture Accessibility Service (Kotlin)
 * - Captures taps and gestures strictly locally
 * - Zero network dispatch (no server connections)
 */
class TouchCaptureAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var isServiceActive: Boolean = false

        fun getUniqueDeviceId(ctx: android.content.Context): String {
            return try {
                val aid = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
                if (!aid.isNullOrBlank()) "node-${aid.takeLast(6)}" else "node-default"
            } catch (_: Exception) {
                "node-default"
            }
        }
    }

    private val localEventBuffer = ConcurrentLinkedQueue<JSONObject>()
    private var screenWidth = 1080
    private var screenHeight = 2400
    private var deviceId = "node-default"

    override fun onServiceConnected() {
        super.onServiceConnected()
        isServiceActive = true
        deviceId = getUniqueDeviceId(this)
        updateScreenSize()
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
                enqueuePoint(cx, cy, action)
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

    private fun enqueuePoint(rawX: Float, rawY: Float, action: String) {
        val nx = (rawX / screenWidth).coerceIn(0.01f, 0.99f)
        val ny = (rawY / screenHeight).coerceIn(0.01f, 0.99f)
        val obj = JSONObject().apply {
            put("nx", nx.toDouble())
            put("ny", ny.toDouble())
            put("action", action)
            put("ts", System.currentTimeMillis())
        }
        localEventBuffer.offer(obj)

        // Keep buffer bounded locally
        while (localEventBuffer.size > 200) {
            localEventBuffer.poll()
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        isServiceActive = false
        localEventBuffer.clear()
        super.onDestroy()
    }
}
