package com.project100.wearablehealth

import android.os.Build
import java.util.concurrent.atomic.AtomicLong
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.time.Duration
import java.time.Instant

class WearableHealthModule : Module() {
  private var pendingPermissionPromise: Promise? = null

  private val healthLiveEnabled = false // HEALTH_LIVE_OFF until signed G1-G4 admission.
  private val consentEpoch = AtomicLong(0)
  // Native trusted issuer remains UNCONFIGURED. No JS setter mints native authority.
  private var admittedAuthority: Map<String, Any?>? = null
  private var pendingPermissionAuthority: Map<String, Any?>? = null
  private fun permissionsForMetric(metric: String) = when(metric) {
    "STEPS" -> setOf(HealthPermission.getReadPermission(StepsRecord::class))
    "WORKOUT" -> setOf(HealthPermission.getReadPermission(ExerciseSessionRecord::class))
    else -> emptySet()
  }

  private val permissionContract =
    PermissionController.createRequestPermissionResultContract()

  override fun definition() = ModuleDefinition {
    Name("WearableHealth")

    Function("isAvailable") {
      availability() == Availability.AVAILABLE
    }

    Function("clearSession") {
      consentEpoch.incrementAndGet(); admittedAuthority = null
      val pending = pendingPermissionPromise; pendingPermissionPromise = null; pendingPermissionAuthority = null
      pending?.resolve(mapOf("state" to "DISCARDED_STALE_EPOCH"))
    }

    AsyncFunction("requestReadAccess") { authority: Map<String, Any?>, promise: Promise ->
      when (availability()) {
        Availability.UNAVAILABLE,
        Availability.PROVIDER_UPDATE_REQUIRED -> {
          promise.resolve(mapOf("state" to "PLATFORM_UNAVAILABLE"))
        }
        Availability.AVAILABLE -> {
          if (!preEffectAuthority(authority, authority["metric"] as? String ?: "")) promise.resolve(mapOf("state" to "HEALTH_LIVE_OFF"))
          else launchPermissionRequest(promise, authority)
        }
      }
    }

    AsyncFunction("readSteps") Coroutine { startedAt: String, endedAt: String, authority: Map<String, Any?> ->
      if (availability() != Availability.AVAILABLE) return@Coroutine mapOf("state" to "PLATFORM_UNAVAILABLE")
      val interval = requestedInterval(startedAt, endedAt)
      if (!preEffectAuthority(authority, "STEPS") || authority["startedAt"] != startedAt || authority["endedAt"] != endedAt) return@Coroutine mapOf("state" to "HEALTH_LIVE_OFF")
      val client = availableClient()
        ?: return@Coroutine mapOf("state" to "PLATFORM_UNAVAILABLE")
      val permission = HealthPermission.getReadPermission(StepsRecord::class)
      if (!client.permissionController.getGrantedPermissions().contains(permission)) {
        return@Coroutine mapOf("state" to "PERMISSION_DENIED")
      }

      if (!preEffectAuthority(authority, authority["metric"] as? String ?: "")) return@Coroutine mapOf("state" to "DISCARDED_STALE_EPOCH")
      val effectiveStart = v1RecentContextStart(interval)
      val response = client.aggregate(
        AggregateRequest(
          metrics = setOf(StepsRecord.COUNT_TOTAL),
          timeRangeFilter = TimeRangeFilter.between(effectiveStart, interval.second)
        )
      )
      if (!preEffectAuthority(authority, "STEPS")) return@Coroutine mapOf("state" to "DISCARDED_STALE_EPOCH")
      val count = response[StepsRecord.COUNT_TOTAL]
        ?: return@Coroutine mapOf("state" to "NO_DATA")
      mapOf(
        "state" to "AVAILABLE",
        "count" to count.toDouble().coerceAtLeast(0.0),
        "dataOrigins" to response.dataOrigins.map { it.packageName }.sorted(),
        "observedStartedAt" to effectiveStart.toString(),
        "observedEndedAt" to interval.second.toString()
      )
    }

    AsyncFunction("readWorkouts") Coroutine { startedAt: String, endedAt: String, authority: Map<String, Any?> ->
      if (availability() != Availability.AVAILABLE) return@Coroutine mapOf("state" to "PLATFORM_UNAVAILABLE")
      val interval = requestedInterval(startedAt, endedAt)
      if (!preEffectAuthority(authority, "WORKOUT") || authority["startedAt"] != startedAt || authority["endedAt"] != endedAt) return@Coroutine mapOf("state" to "HEALTH_LIVE_OFF")
      val client = availableClient()
        ?: return@Coroutine mapOf("state" to "PLATFORM_UNAVAILABLE")
      val permission = HealthPermission.getReadPermission(ExerciseSessionRecord::class)
      if (!client.permissionController.getGrantedPermissions().contains(permission)) {
        return@Coroutine mapOf("state" to "PERMISSION_DENIED")
      }

      if (!preEffectAuthority(authority, authority["metric"] as? String ?: "")) return@Coroutine mapOf("state" to "DISCARDED_STALE_EPOCH")
      val effectiveStart = v1RecentContextStart(interval)
      val workouts = readAllExerciseSessions(client, effectiveStart, interval.second, authority)
        .map { record ->
          mapOf(
            "category" to normalizedWorkoutCategory(record.exerciseType),
            "startedAt" to record.startTime.toString(),
            "endedAt" to record.endTime.toString(),
            "durationMinutes" to Duration.between(record.startTime, record.endTime)
              .toMillis().coerceAtLeast(0).toDouble() / 60_000.0
          )
        }
      if (!preEffectAuthority(authority, "WORKOUT")) return@Coroutine mapOf("state" to "DISCARDED_STALE_EPOCH")
      if (workouts.isEmpty()) {
        mapOf("state" to "NO_DATA")
      } else {
        mapOf("state" to "AVAILABLE", "workouts" to workouts)
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != PERMISSION_REQUEST_CODE) return@OnActivityResult
      val promise = pendingPermissionPromise ?: return@OnActivityResult
      pendingPermissionPromise = null
      val authority = pendingPermissionAuthority; pendingPermissionAuthority = null
      if (authority == null || !preEffectAuthority(authority, authority["metric"] as? String ?: "")) {
        promise.resolve(mapOf("state" to "DISCARDED_STALE_EPOCH")); return@OnActivityResult
      }
      try {
        permissionContract.parseResult(payload.resultCode, payload.data)
        promise.resolve(mapOf("state" to "REQUEST_COMPLETED"))
      } catch (error: Exception) {
        promise.reject("ERR_HEALTH_CONNECT_PERMISSION_RESULT", error.message, error)
      }
    }
  }

  private fun launchPermissionRequest(promise: Promise, authority: Map<String, Any?>) {
    if (!preEffectAuthority(authority, authority["metric"] as? String ?: "")) { promise.resolve(mapOf("state" to "DISCARDED_STALE_EPOCH")); return }
    if (pendingPermissionPromise != null) {
      promise.reject(
        "ERR_HEALTH_CONNECT_PERMISSION_IN_PROGRESS",
        "A Health Connect permission request is already in progress.",
        null
      )
      return
    }
    val context = appContext.reactContext
    val activity = appContext.currentActivity
    if (context == null || activity == null) {
      promise.reject(
        "ERR_HEALTH_CONNECT_ACTIVITY_UNAVAILABLE",
        "An active Android activity is required to request Health Connect permission.",
        null
      )
      return
    }
    pendingPermissionPromise = promise
    pendingPermissionAuthority = authority
    try {
      val intent = permissionContract.createIntent(context, permissionsForMetric(authority["metric"] as? String ?: ""))
      @Suppress("DEPRECATION")
      activity.startActivityForResult(intent, PERMISSION_REQUEST_CODE)
    } catch (error: Exception) {
      pendingPermissionPromise = null; pendingPermissionAuthority = null
      promise.reject("ERR_HEALTH_CONNECT_PERMISSION_REQUEST", error.message, error)
    }
  }

  private fun preEffectAuthority(authority: Map<String, Any?>, metric: String): Boolean {
    if (!healthLiveEnabled || (metric != "STEPS" && metric != "WORKOUT")) return false
    val admitted = admittedAuthority ?: return false
    for (key in listOf("subjectId", "profileId", "taskId")) if ((authority[key] as? String).isNullOrEmpty()) return false
    val generation = (authority["generation"] as? Number)?.toDouble() ?: return false
    val revision = (authority["taskRevision"] as? Number)?.toDouble() ?: return false
    val epoch = (authority["wearableConsentEpoch"] as? Number)?.toLong() ?: return false
    val until = (authority["validUntil"] as? Number)?.toDouble() ?: return false
    if (!generation.isFinite() || generation < 0 || generation % 1.0 != 0.0 || !revision.isFinite() || revision <= 0 || revision % 1.0 != 0.0 || epoch != consentEpoch.get() || until <= System.currentTimeMillis()) return false
    if (authority["metric"] != metric) return false
    for (key in listOf("subjectId","profileId","generation","validUntil","taskId","taskRevision","wearableConsentEpoch","metric","startedAt","endedAt")) if (authority[key] != admitted[key]) return false
    return try { v1RecentContextStart(requestedInterval(authority["startedAt"] as String, authority["endedAt"] as String)); true } catch (_: Exception) { false }
  }

  private fun availability(): Availability {
    if (Build.VERSION.SDK_INT < 28) return Availability.UNAVAILABLE
    val context = appContext.reactContext ?: return Availability.UNAVAILABLE
    return when (HealthConnectClient.getSdkStatus(context)) {
      HealthConnectClient.SDK_AVAILABLE -> Availability.AVAILABLE
      HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
        Availability.PROVIDER_UPDATE_REQUIRED
      HealthConnectClient.SDK_UNAVAILABLE -> Availability.UNAVAILABLE
      else -> Availability.UNAVAILABLE
    }
  }

  private fun availableClient(): HealthConnectClient? {
    if (availability() != Availability.AVAILABLE) return null
    val context = appContext.reactContext ?: return null
    return HealthConnectClient.getOrCreate(context)
  }

  private fun requestedInterval(startedAt: String, endedAt: String): Pair<Instant, Instant> {
    val start = try {
      Instant.parse(startedAt)
    } catch (_: Exception) {
      throw IllegalArgumentException("ERR_WEARABLE_INTERVAL")
    }
    val end = try {
      Instant.parse(endedAt)
    } catch (_: Exception) {
      throw IllegalArgumentException("ERR_WEARABLE_INTERVAL")
    }
    require(start <= end) { "ERR_WEARABLE_INTERVAL" }
    return start to end
  }

  private fun v1RecentContextStart(
    interval: Pair<Instant, Instant>,
    now: Instant = Instant.now()
  ): Instant {
    // Product policy for 100 v1: wearable context is limited to the most recent
    // 30 days. This is not Health Connect's permission or authorization boundary.
    val v1WindowStart = now.minus(V1_RECENT_CONTEXT_WINDOW)
    require(interval.first >= v1WindowStart && interval.second <= now && Duration.between(interval.first, interval.second) <= V1_RECENT_CONTEXT_WINDOW) { ERR_WEARABLE_V1_HISTORY_WINDOW }
    return interval.first
  }

  private suspend fun readAllExerciseSessions(
    client: HealthConnectClient,
    start: Instant,
    end: Instant,
    authority: Map<String, Any?>
  ): List<ExerciseSessionRecord> {
    val records = mutableListOf<ExerciseSessionRecord>()
    var pageToken: String? = null
    do {
      check(preEffectAuthority(authority, "WORKOUT")) { "DISCARDED_STALE_EPOCH" }
      val response = client.readRecords(
        ReadRecordsRequest(
          recordType = ExerciseSessionRecord::class,
          timeRangeFilter = TimeRangeFilter.between(start, end),
          pageToken = pageToken
        )
      )
      check(preEffectAuthority(authority, "WORKOUT")) { "DISCARDED_STALE_EPOCH" }
      records.addAll(response.records)
      pageToken = response.pageToken
    } while (!pageToken.isNullOrEmpty())
    return records
  }

  private fun normalizedWorkoutCategory(exerciseType: Int): String = when (exerciseType) {
    ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "WALK"
    ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
    ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "RUN"
    ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
    ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "CYCLE"
    ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
    ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "STRENGTH"
    ExerciseSessionRecord.EXERCISE_TYPE_BOOT_CAMP,
    ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS,
    ExerciseSessionRecord.EXERCISE_TYPE_EXERCISE_CLASS -> "GENERAL"
    else -> "OTHER"
  }

  private enum class Availability {
    AVAILABLE,
    UNAVAILABLE,
    PROVIDER_UPDATE_REQUIRED
  }

  companion object {
    private const val PERMISSION_REQUEST_CODE = 5201
    private const val ERR_WEARABLE_V1_HISTORY_WINDOW = "ERR_WEARABLE_V1_HISTORY_WINDOW"
    private val V1_RECENT_CONTEXT_WINDOW: Duration = Duration.ofDays(30)
  }
}
