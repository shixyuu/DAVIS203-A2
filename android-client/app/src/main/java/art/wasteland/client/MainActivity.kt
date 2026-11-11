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
import android.text.Editable
import android.text.TextWatcher
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
 * Material You / Material Design 3 (MD3) Telemetry Client
 * - Standalone Zero-Configuration Mode (No URL input required)
 * - Optional Advanced Custom Relay settings (collapsed by default)
 * - Single-click START and STOP controls
 */
class MainActivity : Activity() {

    companion object {
        private const val REQ_PROJECTION = 2001

        // MD3 调色板
        private val MD3_SURFACE = Color.parseColor("#101418")
        private val MD3_SURFACE_CONTAINER = Color.parseColor("#1B2026")
        private val MD3_SURFACE_HIGH = Color.parseColor("#252A30")
        private val MD3_PRIMARY = Color.parseColor("#A8C8E8")
        private val MD3_ON_PRIMARY = Color.parseColor("#10324D")
        private val MD3_PRIMARY_CONTAINER = Color.parseColor("#274865")
        private val MD3_ON_PRIMARY_CONTAINER = Color.parseColor("#CDE5FF")
        private val MD3_OUTLINE = Color.parseColor("#42474E")
        private val MD3_ON_SURFACE = Color.parseColor("#E0E2E8")
        private val MD3_ON_SURFACE_VARIANT = Color.parseColor("#C2C7CF")
        private val MD3_SUCCESS = Color.parseColor("#80D5A3")
        private val MD3_ERROR_CONTAINER = Color.parseColor("#8C1D18")
        private val MD3_ON_ERROR_CONTAINER = Color.parseColor("#F9DEDC")
    }

    private lateinit var statusBadge: TextView
    private lateinit var statusDetail: TextView
    private lateinit var touchInput: EditText
    private lateinit var videoInput: EditText
    private lateinit var connectBtn: Button
    private lateinit var startBtn: Button
    private lateinit var stopBtn: Button
    private lateinit var advancedContainer: LinearLayout
    private lateinit var toggleAdvancedBtn: TextView
    private lateinit var historyChipContainer: LinearLayout

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

    private fun makeBox(bgColor: Int, strokeColor: Int = Color.TRANSPARENT, strokeWidth: Int = 0, radius: Float = 24f): GradientDrawable {
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
            setBackgroundColor(MD3_SURFACE)
            isFillViewport = true
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(32), dp(20), dp(32))
        }
        scroll.addView(container)

        // 1. MD3 Header
        val title = TextView(this).apply {
            text = "Digital Wasteland"
            textSize = 26f
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            setTextColor(MD3_ON_SURFACE)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        container.addView(title)

        val subtitle = TextView(this).apply {
            text = "TELEMETRY SURVEILLANCE NODE"
            textSize = 11f
            letterSpacing = 0.16f
            setTextColor(MD3_PRIMARY)
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(4), 0, dp(14))
        }
        container.addView(subtitle)

        // Device ID MD3 Chip
        val deviceChip = TextView(this).apply {
            text = "DEVICE: $deviceId"
            textSize = 12f
            typeface = Typeface.MONOSPACE
            setTextColor(MD3_ON_PRIMARY_CONTAINER)
            background = makeBox(MD3_PRIMARY_CONTAINER, Color.TRANSPARENT, 0, dp(16).toFloat())
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(8), dp(16), dp(8))
        }
        val deviceLayout = LinearLayout(this).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, dp(20))
            addView(deviceChip)
        }
        container.addView(deviceLayout)

        // 2. MD3 Status Card
        val statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = makeBox(MD3_SURFACE_CONTAINER, MD3_OUTLINE, dp(1), dp(20).toFloat())
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        statusBadge = TextView(this).apply {
            text = "● STATUS: READY"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MD3_SUCCESS)
        }
        statusCard.addView(statusBadge)

        statusDetail = TextView(this).apply {
            text = if (savedTouch.isNotBlank()) "Configured for custom relay: $savedTouch" else "Ready for standalone telemetry. Zero URL setup required."
            textSize = 12f
            setTextColor(MD3_ON_SURFACE_VARIANT)
            setPadding(0, dp(6), 0, 0)
        }
        statusCard.addView(statusDetail)
        container.addView(statusCard)

        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(24)) })

        // 3. Primary Action Buttons (Immediate 1-Click Launch)
        startBtn = Button(this).apply {
            text = "Start Telemetry"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MD3_ON_PRIMARY)
            background = makeBox(MD3_PRIMARY, Color.TRANSPARENT, 0, dp(24).toFloat())
            setPadding(0, dp(16), 0, dp(16))
            setOnClickListener { handleOneClickStart() }
        }
        container.addView(startBtn)

        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(12)) })

        stopBtn = Button(this).apply {
            text = "Stop Telemetry Stream"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MD3_ON_ERROR_CONTAINER)
            background = makeBox(MD3_ERROR_CONTAINER, Color.TRANSPARENT, 0, dp(24).toFloat())
            setPadding(0, dp(14), 0, dp(14))
            setOnClickListener { handleStopTelemetry() }
        }
        container.addView(stopBtn)

        container.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(24)) })

        // 4. Advanced / Optional Custom Relay Settings (Collapsed by default)
        toggleAdvancedBtn = TextView(this).apply {
            text = "▸ Custom Server Relay (Optional)"
            textSize = 12f
            setTextColor(MD3_PRIMARY)
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(8), 0, dp(8))
            setOnClickListener {
                if (advancedContainer.visibility == View.VISIBLE) {
                    advancedContainer.visibility = View.GONE
                    text = "▸ Custom Server Relay (Optional)"
                } else {
                    advancedContainer.visibility = View.VISIBLE
                    text = "▾ Custom Server Relay (Optional)"
                }
            }
        }
        container.addView(toggleAdvancedBtn)

        advancedContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(0, dp(10), 0, 0)
        }

        val touchLabel = TextView(this).apply {
            text = "Touch Relay URL (Leave empty for local mode)"
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MD3_ON_SURFACE_VARIANT)
            setPadding(0, 0, 0, dp(4))
        }
        advancedContainer.addView(touchLabel)

        touchInput = EditText(this).apply {
            setTextColor(MD3_ON_SURFACE)
            textSize = 12f
            typeface = Typeface.MONOSPACE
            background = makeBox(MD3_SURFACE_HIGH, MD3_OUTLINE, dp(1), dp(12).toFloat())
            setPadding(dp(14), dp(12), dp(14), dp(12))
            isSingleLine = true
            hint = "https://your-worker-a.workers.dev"
            setHintTextColor(Color.parseColor("#5A626A"))
            setText(savedTouch)
        }
        advancedContainer.addView(touchInput)

        advancedContainer.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(10)) })

        val videoLabel = TextView(this).apply {
            text = "Video Chunk Relay URL (Leave empty for local mode)"
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MD3_ON_SURFACE_VARIANT)
            setPadding(0, 0, 0, dp(4))
        }
        advancedContainer.addView(videoLabel)

        videoInput = EditText(this).apply {
            setTextColor(MD3_ON_SURFACE)
            textSize = 12f
            typeface = Typeface.MONOSPACE
            background = makeBox(MD3_SURFACE_HIGH, MD3_OUTLINE, dp(1), dp(12).toFloat())
            setPadding(dp(14), dp(12), dp(14), dp(12))
            isSingleLine = true
            hint = "https://your-worker-b.workers.dev"
            setHintTextColor(Color.parseColor("#5A626A"))
            setText(savedVideo)
        }
        advancedContainer.addView(videoInput)

        historyChipContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, dp(10))
        }
        advancedContainer.addView(historyChipContainer)
        renderHistoryChips()

        connectBtn = Button(this).apply {
            text = "Test Custom Connection"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(MD3_ON_PRIMARY_CONTAINER)
            background = makeBox(MD3_PRIMARY_CONTAINER, Color.TRANSPARENT, 0, dp(20).toFloat())
            setPadding(0, dp(12), 0, dp(12))
            setOnClickListener {
                runConnectionTest(touchInput.text.toString().trim(), videoInput.text.toString().trim())
            }
        }
        advancedContainer.addView(connectBtn)

        container.addView(advancedContainer)

        // TextWatcher for auto-saving custom input if typed
        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                PrefManager.saveUrls(this@MainActivity, touchInput.text.toString(), videoInput.text.toString())
            }
        }
        touchInput.addTextChangedListener(watcher)
        videoInput.addTextChangedListener(watcher)

        setContentView(scroll)

        if (savedTouch.isNotBlank()) {
            runConnectionTest(savedTouch, savedVideo, isSilent = true)
        }
    }

    private fun renderHistoryChips() {
        historyChipContainer.removeAllViews()
        val history = PrefManager.getHistoryList(this)
        if (history.isEmpty()) return

        for (addr in history.take(3)) {
            val chip = TextView(this).apply {
                text = if (addr.length > 28) addr.take(25) + "..." else addr
                textSize = 11f
                setTextColor(MD3_PRIMARY)
                background = makeBox(MD3_SURFACE_HIGH, MD3_OUTLINE, dp(1), dp(12).toFloat())
                setPadding(dp(12), dp(6), dp(12), dp(6))
                setOnClickListener {
                    touchInput.setText(addr)
                    PrefManager.saveUrls(this@MainActivity, addr, videoInput.text.toString())
                }
            }
            historyChipContainer.addView(chip)
            historyChipContainer.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(8), 1) })
        }
    }

    override fun onResume() {
        super.onResume()
        updatePermissionStatus()
    }

    private fun updatePermissionStatus() {
        val isRecording = ScreenChunkRecorderService.isServiceRunning
        if (!isAccessibilityEnabled()) {
            startBtn.text = "Grant Accessibility & Start"
            startBtn.background = makeBox(Color.parseColor("#F59E0B"), Color.TRANSPARENT, 0, dp(24).toFloat())
        } else {
            startBtn.text = if (isRecording) "Telemetry Running" else "Start Telemetry"
            startBtn.background = makeBox(
                if (isRecording) Color.parseColor("#059669") else MD3_PRIMARY,
                Color.TRANSPARENT, 0, dp(24).toFloat()
            )
        }
    }

    private fun runConnectionTest(rawTouch: String, rawVideo: String, isSilent: Boolean = false) {
        if (rawTouch.isEmpty()) {
            if (!isSilent) Toast.makeText(this, "Empty URL: Standalone Local Mode", Toast.LENGTH_SHORT).show()
            statusBadge.text = "● STATUS: READY"
            statusBadge.setTextColor(MD3_SUCCESS)
            statusDetail.text = "Standalone mode. Zero server egress."
            return
        }

        var normalizedTouch = rawTouch
        if (!normalizedTouch.startsWith("http://") && !normalizedTouch.startsWith("https://")) {
            normalizedTouch = "https://$normalizedTouch"
        }
        val cleanBaseUrl = normalizedTouch.trimEnd('/')

        statusBadge.text = "● CONNECTING..."
        statusBadge.setTextColor(Color.parseColor("#F59E0B"))
        statusDetail.text = "Testing endpoint $cleanBaseUrl/status ..."
        connectBtn.isEnabled = false

        netExecutor.execute {
            var success = false
            var responseCode = 0
            var errorMsg = ""

            try {
                val targetUrl = URL("$cleanBaseUrl/status")
                val conn = targetUrl.openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.requestMethod = "GET"
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
                    statusBadge.setTextColor(MD3_SUCCESS)
                    statusDetail.text = "Linked to $cleanBaseUrl"

                    PrefManager.saveUrls(this@MainActivity, normalizedTouch, rawVideo)
                    TouchCaptureAccessibilityService.activeTouchUrl = TouchCaptureAccessibilityService.normalizeTouchUrl(normalizedTouch)
                    ScreenChunkRecorderService.activeVideoUrl = ScreenChunkRecorderService.normalizeVideoUrl(rawVideo)

                    renderHistoryChips()
                    updatePermissionStatus()
                    if (!isSilent) Toast.makeText(this@MainActivity, "Connected and Saved!", Toast.LENGTH_SHORT).show()
                } else {
                    isConnected = false
                    statusBadge.text = "● CONNECTION FAILED"
                    statusBadge.setTextColor(Color.parseColor("#EF4444"))
                    statusDetail.text = "Server error: $errorMsg"
                    updatePermissionStatus()
                }
            }
        }
    }

    private fun handleStopTelemetry() {
        stopService(Intent(this, ScreenChunkRecorderService::class.java))
        ScreenChunkRecorderService.isServiceRunning = false
        updatePermissionStatus()
        Toast.makeText(this, "Telemetry stream stopped", Toast.LENGTH_SHORT).show()
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
        } else {
            TouchCaptureAccessibilityService.activeTouchUrl = ""
            ScreenChunkRecorderService.activeVideoUrl = ""
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
            val msg = if (ScreenChunkRecorderService.activeVideoUrl.isNotBlank()) "Telemetry Active (Streaming)" else "Telemetry Active (Local Standalone)"
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            moveTaskToBack(true)
        }
    }
}
