// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package expo.modules.zoggyfinnative

import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.Display
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * Android helpers for Zoggyfin:
 * - the decoders of the device (MediaCodecList) for the device profile;
 * - Picture in Picture on Home for Android 8 to 11. Android 12 and later
 *   enter it automatically through expo-video (`setAutoEnterEnabled`).
 * - `makeSeekableMp4`: a transcoded download from Jellyfin is a fragmented
 *   MP4 with no index (no `sidx`). ExoPlayer cannot seek in it: every seek
 *   goes to 0. The function copies the samples into a plain MP4 (MediaMuxer,
 *   no new encoding), which ExoPlayer seeks in.
 */
class ZoggyfinAndroidModule : Module() {
  /** Set by JavaScript while a video plays in the full player. */
  @Volatile private var autoPictureInPicture = false
  private var report: Map<String, Any?>? = null

  override fun definition() = ModuleDefinition {
    Name("ZoggyfinAndroid")

    /** The decoders and the HDR types of the display. Read once and kept. */
    Function("decoders") {
      val r = report ?: decoderReport()
      report = r
      r
    }

    Function("setAutoPictureInPicture") { enabled: Boolean ->
      autoPictureInPicture = enabled
    }

    /** "done" (rewritten), "skipped" (not fragmented) or "failed" (the file stays as it was). */
    AsyncFunction("makeSeekableMp4") { path: String ->
      makeSeekable(File(path.removePrefix("file://")))
    }

    OnUserLeavesActivity {
      // A permission dialog or the app settings started by the app also counts as "leaving".
      if (SystemClock.elapsedRealtime() < pipHoldUntil) return@OnUserLeavesActivity
      if (autoPictureInPicture && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        enterPictureInPicture()
      }
    }
  }

  private fun enterPictureInPicture() {
    val activity = appContext.currentActivity ?: return
    if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    try {
      // The aspect ratio and the source rectangle come from expo-video (setPictureInPictureParams).
      activity.enterPictureInPictureMode(PictureInPictureParams.Builder().build())
    } catch (e: IllegalStateException) {
      Log.w(TAG, "Picture in Picture is not available", e)
    } catch (e: IllegalArgumentException) {
      Log.w(TAG, "Picture in Picture is not available", e)
    }
  }

  private fun decoderReport(): Map<String, Any?> {
    val infos = try {
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
    } catch (e: RuntimeException) {
      emptyList()
    }
    val out = mutableMapOf<String, Any?>()
    for ((key, mime) in MIMES) {
      var hardware = false
      var software = false
      var maxLevel = 0
      var tenBit = false
      for (info in infos) {
        if (info.supportedTypes.none { it.equals(mime, ignoreCase = true) }) continue
        if (isHardware(info)) hardware = true else software = true
        val caps = try {
          info.getCapabilitiesForType(mime)
        } catch (e: RuntimeException) {
          null
        } ?: continue
        for (pl in caps.profileLevels) {
          maxLevel = maxOf(maxLevel, jellyfinLevel(key, pl.level))
          if (key == "hevc" && (pl.profile == CodecProfileLevel.HEVCProfileMain10 || pl.profile == CodecProfileLevel.HEVCProfileMain10HDR10)) {
            tenBit = true
          }
          if (key == "av1" && pl.profile in AV1_TEN_BIT) tenBit = true
        }
      }
      out[key] = mapOf("hardware" to hardware, "software" to software, "maxLevel" to maxLevel, "tenBit" to tenBit)
    }
    out["hdr"] = hdrTypes()
    out["sdk"] = Build.VERSION.SDK_INT
    return out
  }

  private fun hdrTypes(): List<String> {
    val context = appContext.reactContext ?: return emptyList()
    return try {
      val display = (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(Display.DEFAULT_DISPLAY)
      @Suppress("DEPRECATION")
      val types: IntArray = display?.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
      val names = mutableListOf<String>()
      for (t in types) {
        when (t) {
          Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION -> names.add("dolbyVision")
          Display.HdrCapabilities.HDR_TYPE_HDR10 -> names.add("hdr10")
          Display.HdrCapabilities.HDR_TYPE_HLG -> names.add("hlg")
          4 -> names.add("hdr10Plus")
        }
      }
      names
    } catch (e: RuntimeException) {
      emptyList()
    }
  }

  private fun isHardware(info: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isHardwareAccelerated
    val name = info.name.lowercase()
    return !(name.startsWith("omx.google.") || name.startsWith("c2.android.") || name.startsWith("c2.google.") ||
      name.startsWith("omx.ffmpeg.") || name.contains(".sw.") || name.endsWith(".sw"))
  }

  /** The level in the numbers the Jellyfin server uses: H.264 5.1 is 51, HEVC 5.1 is 153. */
  private fun jellyfinLevel(key: String, level: Int): Int = when (key) {
    "h264" -> AVC_LEVELS.lastOrNull { (flag, _) -> level >= flag }?.second ?: 0
    "hevc" -> HEVC_LEVELS.lastOrNull { (flag, _) -> level >= flag }?.second ?: 0
    else -> 0
  }

  /** True when the file has a top-level `moof` box (a fragmented MP4). */
  private fun isFragmented(f: File): Boolean {
    RandomAccessFile(f, "r").use { raf ->
      val len = raf.length()
      var pos = 0L
      val head = ByteArray(16)
      var boxes = 0
      while (pos + 8 <= len && boxes < 64) {
        raf.seek(pos)
        raf.readFully(head, 0, 8)
        var size = ByteBuffer.wrap(head, 0, 4).int.toLong() and 0xffffffffL
        val type = String(head, 4, 4, Charsets.US_ASCII)
        if (type == "moof") return true
        if (size == 1L) {
          raf.readFully(head, 8, 8)
          size = ByteBuffer.wrap(head, 8, 8).long
        } else if (size == 0L) {
          return false
        }
        if (size < 8) return false
        pos += size
        boxes++
      }
      return false
    }
  }

  private fun makeSeekable(input: File): String {
    if (!input.isFile) return "failed"
    try {
      if (!isFragmented(input)) return "skipped"
    } catch (e: Exception) {
      return "failed"
    }
    val tmp = File(input.path + ".remux")
    val ok = try {
      remux(input, tmp)
    } catch (e: Exception) {
      Log.w(TAG, "Remux failed", e)
      false
    }
    if (!ok || tmp.length() == 0L || !tmp.renameTo(input)) {
      tmp.delete()
      return "failed"
    }
    return "done"
  }

  /** Copies the audio and video samples into a plain MP4 with MediaMuxer. */
  private fun remux(input: File, output: File): Boolean {
    val extractor = MediaExtractor()
    var muxer: MediaMuxer? = null
    try {
      extractor.setDataSource(input.path)
      val m = MediaMuxer(output.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      muxer = m
      val tracks = HashMap<Int, Int>()
      var bufferSize = 1 shl 20
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
        extractor.selectTrack(i)
        tracks[i] = m.addTrack(format)
        if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
          bufferSize = maxOf(bufferSize, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
        }
        if (mime.startsWith("video/") && format.containsKey(MediaFormat.KEY_ROTATION)) {
          m.setOrientationHint(format.getInteger(MediaFormat.KEY_ROTATION))
        }
      }
      if (tracks.isEmpty()) return false
      m.start()
      var buffer = ByteBuffer.allocateDirect(bufferSize)
      val info = android.media.MediaCodec.BufferInfo()
      while (true) {
        val track = extractor.sampleTrackIndex
        if (track < 0) break
        val size = try {
          extractor.readSampleData(buffer, 0)
        } catch (e: IllegalArgumentException) {
          // The sample is larger than the buffer: grow it and read again.
          buffer = ByteBuffer.allocateDirect(buffer.capacity() * 2)
          continue
        }
        if (size < 0) break
        val out = tracks[track]
        val time = extractor.sampleTime
        // MediaMuxer refuses negative times (the audio priming of some encoders).
        if (out != null && time >= 0) {
          info.set(0, size, time, if (extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
          m.writeSampleData(out, buffer, info)
        }
        extractor.advance()
      }
      m.stop()
      return true
    } finally {
      try {
        muxer?.release()
      } catch (e: Exception) {
        // Released already.
      }
      extractor.release()
    }
  }

  companion object {
    private const val TAG = "ZoggyfinAndroid"

    /** No Picture in Picture on "leave" before this time (elapsedRealtime ms). */
    @Volatile var pipHoldUntil = 0L

    /** The app starts its own activity (a permission dialog, the settings) now: that is not the user leaving. */
    fun holdPictureInPicture(ms: Long = 2000) {
      pipHoldUntil = SystemClock.elapsedRealtime() + ms
    }

    /** AV1 Main 10 profiles (API 29 constants; the values are plain ints). */
    private val AV1_TEN_BIT = setOf(
      CodecProfileLevel.AV1ProfileMain10,
      CodecProfileLevel.AV1ProfileMain10HDR10,
      CodecProfileLevel.AV1ProfileMain10HDR10Plus,
    )

    private val MIMES = listOf(
      "h264" to "video/avc",
      "hevc" to "video/hevc",
      "vp9" to "video/x-vnd.on2.vp9",
      "av1" to "video/av01",
      "dolbyVision" to "video/dolby-vision",
      "aac" to "audio/mp4a-latm",
      "mp3" to "audio/mpeg",
      "ac3" to "audio/ac3",
      "eac3" to "audio/eac3",
      "dts" to "audio/vnd.dts",
      "truehd" to "audio/true-hd",
      "flac" to "audio/flac",
      "opus" to "audio/opus",
      "vorbis" to "audio/vorbis",
      "alac" to "audio/alac",
    )

    /** Level flags in increasing order with the server numbers. */
    private val AVC_LEVELS = listOf(
      CodecProfileLevel.AVCLevel1 to 10,
      CodecProfileLevel.AVCLevel11 to 11,
      CodecProfileLevel.AVCLevel12 to 12,
      CodecProfileLevel.AVCLevel13 to 13,
      CodecProfileLevel.AVCLevel2 to 20,
      CodecProfileLevel.AVCLevel21 to 21,
      CodecProfileLevel.AVCLevel22 to 22,
      CodecProfileLevel.AVCLevel3 to 30,
      CodecProfileLevel.AVCLevel31 to 31,
      CodecProfileLevel.AVCLevel32 to 32,
      CodecProfileLevel.AVCLevel4 to 40,
      CodecProfileLevel.AVCLevel41 to 41,
      CodecProfileLevel.AVCLevel42 to 42,
      CodecProfileLevel.AVCLevel5 to 50,
      CodecProfileLevel.AVCLevel51 to 51,
      CodecProfileLevel.AVCLevel52 to 52,
      0x20000 to 60,
      0x40000 to 61,
      0x80000 to 62,
    )

    /** Main and high tier flags of one level are next to each other; both give the same number. */
    private val HEVC_LEVELS = listOf(
      CodecProfileLevel.HEVCMainTierLevel1 to 30,
      CodecProfileLevel.HEVCMainTierLevel2 to 60,
      CodecProfileLevel.HEVCMainTierLevel21 to 63,
      CodecProfileLevel.HEVCMainTierLevel3 to 90,
      CodecProfileLevel.HEVCMainTierLevel31 to 93,
      CodecProfileLevel.HEVCMainTierLevel4 to 120,
      CodecProfileLevel.HEVCMainTierLevel41 to 123,
      CodecProfileLevel.HEVCMainTierLevel5 to 150,
      CodecProfileLevel.HEVCMainTierLevel51 to 153,
      CodecProfileLevel.HEVCMainTierLevel52 to 156,
      CodecProfileLevel.HEVCMainTierLevel6 to 180,
      CodecProfileLevel.HEVCMainTierLevel61 to 183,
      CodecProfileLevel.HEVCMainTierLevel62 to 186,
    )
  }
}
