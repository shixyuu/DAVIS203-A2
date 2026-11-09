package art.wasteland.client

import android.content.Context
import android.content.SharedPreferences

object PrefManager {
    private const val PREF_NAME = "wasteland_telemetry_prefs"
    private const val KEY_TOUCH_URL = "key_touch_url"
    private const val KEY_VIDEO_URL = "key_video_url"

    private fun getPrefs(ctx: Context): SharedPreferences {
        return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    fun getTouchUrl(ctx: Context): String {
        return getPrefs(ctx).getString(KEY_TOUCH_URL, "") ?: ""
    }

    fun getVideoUrl(ctx: Context): String {
        return getPrefs(ctx).getString(KEY_VIDEO_URL, "") ?: ""
    }

    fun saveUrls(ctx: Context, touchUrl: String, videoUrl: String) {
        getPrefs(ctx).edit()
            .putString(KEY_TOUCH_URL, touchUrl.trim())
            .putString(KEY_VIDEO_URL, videoUrl.trim())
            .apply()
    }
}
