package art.wasteland.client

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Minimal One-Click Telemetry Launcher (Kotlin)
 * Single button to start both touch capture and screen chunk relay
 */
class MainActivity : Activity() {

    companion object {
        private const val REQ_PROJECTION = 2001
    }

    private lateinit var startButton: Button
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#060709"))
            setPadding(64, 64, 64, 64)
        }

        val title = TextView(this).apply {
            text = "DIGITAL WASTELAND"
            textSize = 24f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }

        statusText = TextView(this).apply {
            text = "Status: Ready"
            textSize = 13f
            setTextColor(Color.parseColor("#7D8590"))
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 64)
        }

        startButton = Button(this).apply {
            text = "START TELEMETRY"
            textSize = 15f
            setPadding(64, 36, 64, 36)
            setOnClickListener { handleOneClickStart() }
        }

        root.addView(title)
        root.addView(statusText)
        root.addView(startButton)
        setContentView(root)
    }

    override fun onResume() {
        super.onResume()
        if (isAccessibilityEnabled()) {
            statusText.text = "Accessibility active. Tap below to start relay."
            startButton.text = "START TELEMETRY"
        } else {
            statusText.text = "Accessibility service permission required."
            startButton.text = "GRANT PERMISSION & START"
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
        if (!isAccessibilityEnabled()) {
            Toast.makeText(this, "Please enable [Digital Wasteland Telemetry] in Accessibility Settings", Toast.LENGTH_LONG).show()
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
            Toast.makeText(this, "Background capture active (Local)", Toast.LENGTH_SHORT).show()
            moveTaskToBack(true)
        }
    }
}
