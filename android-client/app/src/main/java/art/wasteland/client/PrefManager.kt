package art.wasteland.client

import android.content.Context
import android.content.SharedPreferences

object PrefManager {
    private const val PREF_NAME = "wasteland_telemetry_prefs"
    private const val KEY_TOUCH_URL = "key_touch_url"
    private const val KEY_VIDEO_URL = "key_video_url"
    private const val KEY_HISTORY = "key_address_history"

    // 默认内置的 Cloudflare Worker 生产端点
    const val DEFAULT_TOUCH_URL = "https://digital-wasteland-worker-a-touch.dsm-project.workers.dev"
    const val DEFAULT_VIDEO_URL = "https://digital-wasteland-worker-b-video.dsm-project.workers.dev"

    private fun getPrefs(ctx: Context): SharedPreferences {
        return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    fun getTouchUrl(ctx: Context): String {
        val saved = getPrefs(ctx).getString(KEY_TOUCH_URL, null)
        return saved ?: DEFAULT_TOUCH_URL
    }

    fun getVideoUrl(ctx: Context): String {
        val saved = getPrefs(ctx).getString(KEY_VIDEO_URL, null)
        return saved ?: DEFAULT_VIDEO_URL
    }

    fun saveUrls(ctx: Context, touchUrl: String, videoUrl: String) {
        val cleanTouch = touchUrl.trim()
        val cleanVideo = videoUrl.trim()
        val prefs = getPrefs(ctx)

        // 保存历史记忆列表
        val historySet = prefs.getStringSet(KEY_HISTORY, mutableSetOf())?.toMutableSet() ?: mutableSetOf()
        if (cleanTouch.isNotEmpty()) historySet.add(cleanTouch)
        if (cleanVideo.isNotEmpty()) historySet.add(cleanVideo)

        prefs.edit()
            .putString(KEY_TOUCH_URL, cleanTouch)
            .putString(KEY_VIDEO_URL, cleanVideo)
            .putStringSet(KEY_HISTORY, historySet)
            .apply()
    }

    fun getHistoryList(ctx: Context): List<String> {
        val set = getPrefs(ctx).getStringSet(KEY_HISTORY, emptySet()) ?: emptySet()
        return set.toList().sortedDescending()
    }
}
