package art.wasteland.client

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Universal Precompiled Telemetry Client (Kotlin)
 * - Allows operator to enter any Cloudflare Worker relay URL
 * - Automatic connection verification with live HTTP status indicator
 * - Persistent configuration stored via PrefManager
 */
class MainActivity : Activity() {

    companion object {
        private const val REQ_PROJECTION = 2001
    }

    private lateinit var statusBadge: TextView
    private lateinit var statusDetail: TextView
    private lateinit var touchInput: EditText
    private lateinit var videoInput: EditText
    private lateinit var connectBtn: Button
    private lateinit var startBtn: Button

    private val netExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isConnected = false

    private fun dp(dpVal: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dpVal.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun makeBox(bgColor: Int, strokeColor: Int = Color.TRANSPARENT, strokeWidth: Int = 0, radius: Float = 16f): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(bgColor)
            if (strokeWidth > 0) setStroke(strokeWidth, strokeColor)
            cornerRadius = radius
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val deviceId = TouchCaptureAccessibilityService.getUniqueDeviceId(this)
        val savedTouch = PrefManager.getTouchUrl(this)
        val savedVideo = PrefManager.getVideoUrl(this)

        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#07090E"))
            isFillViewport = true
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(36), dp(24), dp(36))
        }
        scroll.addView(container)

        // 1. Header
        val title = TextView(this).apply {
            text = "DIGITAL WASTELAND"
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#F1F5F9"))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        container.addView(title)

        val subtitle = TextView(this).apply {
            text = "TELEMETRY SURVEILLANCE NODE"
            textSize = 11f
            letterSpacing = 0.15f
            setTextColor(Color.parseColor("#00E5FF"))
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(4), 0, dp(12))
        }
        container.addView(subtitle)

        val deviceBadge = TextView(this).apply {
            text = "DEVICE: $deviceId"
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setTextColor(Color.parseColor("#94A3B8"))
            background = makeBox(Color.parseColor("#0F172A"), Color.parseColor("#1E293B"), dp(1), dp(8).toFloat())
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(6), dp(12), dp(6))
        }
        val deviceLayout = LinearLayout(this).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, dp(24))
            addView(deviceBadge)
        }
        container.addView(deviceLayout)

        // 2. Status Card
        val statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = makeBox(Color.parseColor("#0D131F"), Color.parseColor("#1E293B"), dp(1), dp(12).toFloat())
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }

        statusBadge = TextView(this).apply {
            text = "● STATUS: NOT CONNECTED"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#EF4444"))
        }
        statusCard.addView(statusBadge)

        statusDetail = TextView(this).apply {
            text = "Enter relay server URL below to link this node to the exhibition installation."
            textSize = 12f
            setTextColor(Color.parseColor("#64748B"))
            setPadding(0, dp(6), 0, 0)
        }
        statusCard.addView(statusDetail)
        container.addView(statusCard)

        // Spacer
        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(24)) })

        // 3. Inputs
        val touchLabel = TextView(this).apply {
            text = "RELAY SERVER URL (TOUCH)"
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.08f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 0, 0, dp(6))
        }
        container.addView(touchLabel)

        touchInput = EditText(this).apply {
            hint = "https://your-touch-worker.workers.dev"
            setHintTextColor(Color.parseColor("#475569"))
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = Typeface.MONOSPACE
            background = makeBox(Color.parseColor("#111827"), Color.parseColor("#374151"), dp(1), dp(8).toFloat())
            setPadding(dp(14), dp(12), dp(14), dp(12))
            isSingleLine = true
            setText(savedTouch)
        }
        container.addView(touchInput)

        // Spacer
        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(16)) })

        val videoLabel = TextView(this).apply {
            text = "VIDEO RELAY URL (OPTIONAL CHUNKS)"
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.08f
            setTextColor(Color.parseColor("#94A3B8"))
            setPadding(0, 0, 0, dp(6))
        }
        container.addView(videoLabel)

        videoInput = EditText(this).apply {
            hint = "https://your-video-worker.workers.dev"
            setHintTextColor(Color.parseColor("#475569"))
            setTextColor(Color.WHITE)
            textSize = 13f
            typeface = Typeface.MONOSPACE
            background = makeBox(Color.parseColor("#111827"), Color.parseColor("#374151"), dp(1), dp(8).toFloat())
            setPadding(dp(14), dp(12), dp(14), dp(12))
            isSingleLine = true
            setText(savedVideo)
        }
        container.addView(videoInput)

        // Spacer
        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(24)) })

        // 4. Connect Button
        connectBtn = Button(this).apply {
            text = "TEST & CONNECT SERVER"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            background = makeBox(Color.parseColor("#2563EB"), Color.TRANSPARENT, 0, dp(8).toFloat())
            setPadding(0, dp(14), 0, dp(14))
            setOnClickListener {
                runConnectionTest(touchInput.text.toString().trim(), videoInput.text.toString().trim())
            }
        }
        container.addView(connectBtn)

        // Spacer
        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(16)) })

        // 5. Start Telemetry Button
        startBtn = Button(this).apply {
            text = "START TELEMETRY"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            background = makeBox(Color.parseColor("#059669"), Color.TRANSPARENT, 0, dp(8).toFloat())
            setPadding(0, dp(16), 0, dp(16))
            setOnClickListener { handleOneClickStart() }
        }
        container.addView(startBtn)

        val tipText = TextView(this).apply {
            text = "Note: If server URL is empty or unverified, telemetry will log gestures locally without network exfiltration."
            textSize = 11f
            setTextColor(Color.parseColor("#475569"))
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(18), 0, 0)
        }
        container.addView(tipText)

        setContentView(scroll)

        // If previously saved URL exists, trigger auto-check
        if (savedTouch.isNotEmpty()) {
            runConnectionTest(savedTouch, savedVideo, isSilent = true)
        }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatus()
    }

    private fun updatePermissionStatus() {
        if (!isAccessibilityEnabled()) {
            startBtn.text = "GRANT ACCESSIBILITY & START"
            startBtn.background = makeBox(Color.parseColor("#D97706"), Color.TRANSPARENT, 0, dp(8).toFloat())
        } else {
            startBtn.text = if (isConnected) "START ACTIVE TELEMETRY" else "START LOCAL TELEMETRY"
            startBtn.background = makeBox(
                if (isConnected) Color.parseColor("#059669") else Color.parseColor("#374151"),
                Color.TRANSPARENT, 0, dp(8).toFloat()
            )
        }
    }

    private fun runConnectionTest(rawTouch: String, rawVideo: String, isSilent: Boolean = false) {
        if (rawTouch.isEmpty()) {
            if (!isSilent) {
                Toast.makeText(this, "Please enter a Server URL", Toast.LENGTH_SHORT).show()
            }
            return
        }

        var normalizedTouch = rawTouch
        if (!normalizedTouch.startsWith("http://") && !normalizedTouch.startsWith("https://")) {
            normalizedTouch = "https://$normalizedTouch"
        }
        val cleanBaseUrl = normalizedTouch.trimEnd('/')

        statusBadge.text = "● CONNECTING..."
        statusBadge.setTextColor(Color.parseColor("#F59E0B"))
        statusDetail.text = "Pinging endpoint $cleanBaseUrl/status ..."
        connectBtn.isEnabled = false

        netExecutor.execute {
            var success = false
            var responseCode = 0
            var errorMsg = ""

            try {
                // Cloudflare Worker status probe
                val targetUrl = URL("$cleanBaseUrl/status")
                val conn = targetUrl.openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.requestMethod = "GET"
                conn.instanceFollowRedirects = true
                responseCode = conn.responseCode
                if (responseCode in 200..399) {
                    success = true
                } else {
                    errorMsg = "HTTP $responseCode"
                }
                conn.disconnect()
            } catch (e: Exception) {
                errorMsg = e.localizedMessage ?: "Connection timed out"
            }

            mainHandler.post {
                connectBtn.isEnabled = true
                if (success) {
                    isConnected = true
                    statusBadge.text = "● CONNECTED (HTTP $responseCode)"
                    statusBadge.setTextColor(Color.parseColor("#10B981"))
                    statusDetail.text = "Successfully linked to $cleanBaseUrl\nReady to stream real-time gestures."

                    // Save configuration
                    PrefManager.saveUrls(this@MainActivity, normalizedTouch, rawVideo)
                    TouchCaptureAccessibilityService.activeTouchUrl = TouchCaptureAccessibilityService.normalizeTouchUrl(normalizedTouch)
                    ScreenChunkRecorderService.activeVideoUrl = ScreenChunkRecorderService.normalizeVideoUrl(rawVideo)

                    updatePermissionStatus()
                    Toast.makeText(this@MainActivity, "Connected successfully!", Toast.LENGTH_SHORT).show()
                } else {
                    isConnected = false
                    statusBadge.text = "● CONNECTION FAILED"
                    statusBadge.setTextColor(Color.parseColor("#EF4444"))
                    statusDetail.text = "Failed to reach server: $errorMsg\nPlease verify the domain and device network."
                    updatePermissionStatus()
                }
            }
        }
    }

    private fun isAccessibilityEnabled(): Boolean {
        if (TouchCaptureAccessibilityService.isServiceActive) return true
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.contains(packageName)
    }

    @Suppress("DEPRECATION")
    private fun handleOneClickStart() {
        val touch = touchInput.text.toString().trim()
        val video = videoInput.text.toString().trim()
        if (touch.isNotEmpty()) {
            PrefManager.saveUrls(this, touch, video)
            TouchCaptureAccessibilityService.activeTouchUrl = TouchCaptureAccessibilityService.normalizeTouchUrl(touch)
            ScreenChunkRecorderService.activeVideoUrl = ScreenChunkRecorderService.normalizeVideoUrl(video)
        }

        if (!isAccessibilityEnabled()) {
            Toast.makeText(this, "Enable [Digital Wasteland Telemetry] in Accessibility Settings", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }

        val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(mpManager.createScreenCaptureIntent(), REQ_PROJECTION)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PROJECTION && resultCode == RESULT_OK && data != null) {
            val svc = Intent(this, ScreenChunkRecorderService::class.java).apply {
                putExtra(ScreenChunkRecorderService.EXTRA_RESULT_CODE, resultCode)
                putExtra(ScreenChunkRecorderService.EXTRA_RESULT_DATA, data)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc)
            } else {
                startService(svc)
            }
            Toast.makeText(this, "Telemetry Active (Streaming)", Toast.LENGTH_SHORT).show()
            moveTaskToBack(true)
        }
    }
}
