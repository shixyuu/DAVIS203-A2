package art.wasteland.client

import android.app.*
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * 15-second Low-Bitrate Screen Chunk Recorder Service (Kotlin)
 * - Records local 15-second MP4 slices
 * - Uploads to user-configured video relay URL if provided
 */
class ScreenChunkRecorderService : Service() {

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"

        @Volatile
        var isServiceRunning: Boolean = false

        @Volatile
        var activeVideoUrl: String = ""

        private const val CHUNK_DURATION_MS = 15_000
        // Width and height are multiples of 16 (480x848) for universal Android hardware H.264 encoder compatibility
        private const val VIDEO_WIDTH = 480
        private const val VIDEO_HEIGHT = 848
        private const val VIDEO_BITRATE = 250_000
        private const val VIDEO_FPS = 15

        fun normalizeVideoUrl(rawUrl: String): String {
            val trimmed = rawUrl.trim()
            if (trimmed.isEmpty()) return ""
            var u = trimmed
            if (!u.startsWith("http://") && !u.startsWith("https://")) {
                u = "https://$u"
            }
            if (!u.contains("/upload-chunk")) {
                u = u.trimEnd('/') + "/upload-chunk?room=main"
            }
            return u
        }
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var mediaRecorder: MediaRecorder? = null

    private val isRecording = AtomicBoolean(false)
    private val chunkCounter = AtomicInteger(0)
    private val uploadExecutor = Executors.newFixedThreadPool(2)
    private val mainHandler = Handler(Looper.getMainLooper())

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundNotification()

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            ?: Activity.RESULT_CANCELED
        val resultData: Intent? = intent?.getParcelableExtra(EXTRA_RESULT_DATA)

        activeVideoUrl = PrefManager.getVideoUrl(this)

        if (resultCode == Activity.RESULT_OK && resultData != null && !isRecording.get()) {
            val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val projection = mpManager.getMediaProjection(resultCode, resultData)
            // Required by Android 14 (API 34) prior to createVirtualDisplay
            projection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    isRecording.set(false)
                }
            }, mainHandler)

            mediaProjection = projection
            isRecording.set(true)
            isServiceRunning = true
            startNextChunkSegment()
        }
        return START_STICKY
    }

    @Suppress("DEPRECATION")
    private fun startNextChunkSegment() {
        if (!isRecording.get() || mediaProjection == null) return

        val index = chunkCounter.getAndIncrement()
        val outputFile = File(cacheDir, "chunk_${System.currentTimeMillis()}_$index.mp4")

        try {
            val recorder = MediaRecorder().apply {
                setVideoSource(MediaRecorder.VideoSource.SURFACE)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                setVideoSize(VIDEO_WIDTH, VIDEO_HEIGHT)
                setVideoFrameRate(VIDEO_FPS)
                setVideoEncodingBitRate(VIDEO_BITRATE)
                setOutputFile(outputFile.absolutePath)
                setMaxDuration(CHUNK_DURATION_MS)
                setOnInfoListener { _, what, _ ->
                    if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
                        rotateChunkSegment(index, outputFile)
                    }
                }
                prepare()
            }

            if (virtualDisplay == null) {
                virtualDisplay = mediaProjection?.createVirtualDisplay(
                    "DigitalWasteland",
                    VIDEO_WIDTH,
                    VIDEO_HEIGHT,
                    resources.displayMetrics.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    recorder.surface,
                    null,
                    null
                )
            } else {
                virtualDisplay?.surface = recorder.surface
            }

            recorder.start()
            mediaRecorder = recorder
        } catch (_: Exception) {}
    }

    private fun rotateChunkSegment(chunkIndex: Int, completedFile: File) {
        try {
            mediaRecorder?.apply {
                stop()
                reset()
                release()
            }
        } catch (_: Exception) {}
        mediaRecorder = null

        if (isRecording.get()) {
            startNextChunkSegment()
        }

        val targetUrl = activeVideoUrl
        if (targetUrl.isNotBlank() && completedFile.exists() && completedFile.length() > 0L) {
            uploadExecutor.execute {
                uploadFile(chunkIndex, completedFile, targetUrl)
            }
        } else {
            completedFile.delete()
        }
    }

    private fun uploadFile(chunkIndex: Int, file: File, targetUrl: String) {
        if (!file.exists() || file.length() == 0L) return
        val normalizedEndpoint = normalizeVideoUrl(targetUrl)
        val devId = TouchCaptureAccessibilityService.getUniqueDeviceId(this)
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(normalizedEndpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 12000
                readTimeout = 15000
                doOutput = true
                setFixedLengthStreamingMode(file.length().toInt())
                setRequestProperty("Content-Type", "video/mp4")
                setRequestProperty("X-Device-Id", devId)
                setRequestProperty("X-Chunk-Index", chunkIndex.toString())
                setRequestProperty("X-Chunk-Duration", "15")
                setRequestProperty("X-Mime-Type", "video/mp4")
                setRequestProperty("X-Recorded-At", System.currentTimeMillis().toString())
            }
            file.inputStream().use { input ->
                conn.outputStream.use { output ->
                    input.copyTo(output)
                }
            }
            conn.responseCode
        } catch (_: Exception) {
        } finally {
            conn?.disconnect()
            file.delete()
        }
    }

    @Suppress("DEPRECATION")
    private fun startForegroundNotification() {
        val channelId = "wasteland_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Digital Wasteland",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
            val notification = Notification.Builder(this, channelId)
                .setContentTitle("Digital Wasteland Telemetry")
                .setContentText("Screen chunk recording active")
                .setSmallIcon(android.R.drawable.presence_video_online)
                .build()
            startForeground(1001, notification)
        } else {
            val notification = Notification.Builder(this)
                .setContentTitle("Digital Wasteland Telemetry")
                .setContentText("Screen chunk recording active")
                .setSmallIcon(android.R.drawable.presence_video_online)
                .build()
            startForeground(1001, notification)
        }
    }

    override fun onDestroy() {
        isRecording.set(false)
        isServiceRunning = false
        try {
            mediaRecorder?.stop()
            mediaRecorder?.release()
            virtualDisplay?.release()
            mediaProjection?.stop()
        } catch (_: Exception) {}
        uploadExecutor.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
