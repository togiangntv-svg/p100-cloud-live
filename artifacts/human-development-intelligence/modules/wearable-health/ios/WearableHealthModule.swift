import ExpoModulesCore
import Foundation
import HealthKit

public final class WearableHealthModule: Module {
  private let healthStore = HKHealthStore()
  private let effectLock = NSRecursiveLock()
  private let healthLiveEnabled = false // HEALTH_LIVE_OFF until separately admitted signed-device G1-G4.
  private var consentEpoch = 0
  // No JS setter: the native trusted issuer is UNCONFIGURED, not fabricated from IDs.
  private var admittedAuthority: [String: Any]? = nil
  private var activeQueries: [UUID: (query: HKQuery, promise: Promise)] = [:]

  public func definition() -> ModuleDefinition {
    Name("WearableHealth")

    Function("isAvailable") {
      self.supportsHealthReadIntegration()
    }

    Function("clearSession") {
      self.effectLock.lock(); defer { self.effectLock.unlock() }
      self.consentEpoch += 1; self.admittedAuthority = nil
      let queries = Array(self.activeQueries.values); self.activeQueries.removeAll()
      for entry in queries { self.healthStore.stop(entry.query); entry.promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
    }

    AsyncFunction("requestReadAccess") { (authority: [String: Any], promise: Promise) in
      guard self.supportsHealthReadIntegration() else {
        return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
      }
      guard self.preEffectAuthority(authority, metric: authority["metric"] as? String ?? "") else {
        return promise.resolve(["state": "HEALTH_LIVE_OFF"])
      }
      guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else {
        return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
      }

      let readTypes: Set<HKObjectType> = authority["metric"] as? String == "STEPS"
        ? [steps] : [HKObjectType.workoutType()]
      self.effectLock.lock(); defer { self.effectLock.unlock() }
      guard self.preEffectAuthority(authority, metric: authority["metric"] as? String ?? "") else { return promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
      self.healthStore.requestAuthorization(toShare: [], read: readTypes) { success, error in
        guard self.preEffectAuthority(authority, metric: authority["metric"] as? String ?? "") else { return promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
        if let error {
          if self.isHealthDataRestricted(error) {
            return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
          }
          return promise.reject(error)
        }
        guard success else {
          return promise.reject(
            "ERR_HEALTHKIT_AUTHORIZATION_REQUEST",
            "The HealthKit authorization request did not complete."
          )
        }
        // Apple deliberately does not disclose per-type read authorization.
        // Completion means only that the authorization sheet finished.
        promise.resolve(["state": "REQUEST_COMPLETED"])
      }
    }

    AsyncFunction("readSteps") { (startedAt: String, endedAt: String, authority: [String: Any], promise: Promise) in
      guard self.supportsHealthReadIntegration() else {
        return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
      }
      guard self.preEffectAuthority(authority, metric: "STEPS"), authority["startedAt"] as? String == startedAt, authority["endedAt"] as? String == endedAt else { return promise.resolve(["state": "HEALTH_LIVE_OFF"]) }
      guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount),
            let interval = self.requestedInterval(startedAt: startedAt, endedAt: endedAt) else {
        return promise.reject("ERR_WEARABLE_INTERVAL", "The requested wearable interval is invalid.")
      }

      self.executeStepsQuery(
        steps: steps,
        start: interval.start,
        end: interval.end,
        authority: authority,
        promise: promise
      )
    }

    AsyncFunction("readWorkouts") { (startedAt: String, endedAt: String, authority: [String: Any], promise: Promise) in
      guard self.supportsHealthReadIntegration() else {
        return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
      }
      guard self.preEffectAuthority(authority, metric: "WORKOUT"), authority["startedAt"] as? String == startedAt, authority["endedAt"] as? String == endedAt else { return promise.resolve(["state": "HEALTH_LIVE_OFF"]) }
      guard let interval = self.requestedInterval(startedAt: startedAt, endedAt: endedAt) else {
        return promise.reject("ERR_WEARABLE_INTERVAL", "The requested wearable interval is invalid.")
      }

      let workoutType = HKObjectType.workoutType()
      self.executeWorkoutQuery(
        workoutType: workoutType,
        start: interval.start,
        end: interval.end,
        authority: authority,
        promise: promise
      )
    }
  }

  private func claimQuery(_ id: UUID) -> Bool { effectLock.lock(); defer { effectLock.unlock() }; return activeQueries.removeValue(forKey: id) != nil }
  private func preEffectAuthority(_ authority: [String: Any], metric: String) -> Bool {
    effectLock.lock(); defer { effectLock.unlock() }
    guard healthLiveEnabled, let admitted = admittedAuthority, metric == "STEPS" || metric == "WORKOUT",
      let subject = authority["subjectId"] as? String, !subject.isEmpty,
      let profile = authority["profileId"] as? String, !profile.isEmpty,
      let task = authority["taskId"] as? String, !task.isEmpty,
      let generation = authority["generation"] as? Int, generation >= 0,
      let revision = authority["taskRevision"] as? Int, revision > 0,
      let epoch = authority["wearableConsentEpoch"] as? Int, epoch == consentEpoch,
      let until = authority["validUntil"] as? Double, until > Date().timeIntervalSince1970 * 1000,
      authority["metric"] as? String == metric else { return false }
    for key in ["subjectId","profileId","generation","validUntil","taskId","taskRevision","wearableConsentEpoch","metric","startedAt","endedAt"] {
      guard let value = authority[key] as? NSObject, let current = admitted[key] as? NSObject, value.isEqual(current) else { return false }
    }
    guard let start = authority["startedAt"] as? String, let end = authority["endedAt"] as? String, requestedInterval(startedAt: start, endedAt: end) != nil else { return false }
    return true
  }

  private func supportsHealthReadIntegration() -> Bool {
    // This release cannot safely read limited Health history on iOS 27+.
    // Keep it unavailable until a separately reviewed native implementation.
    if #available(iOS 27.0, *) {
      return false
    }
    return HKHealthStore.isHealthDataAvailable()
  }

  private func executeStepsQuery(
    steps: HKQuantityType,
    start: Date,
    end: Date,
    authority: [String: Any],
    promise: Promise
  ) {
    let predicate = HKQuery.predicateForSamples(
      withStart: start,
      end: end,
      options: [.strictStartDate, .strictEndDate]
    )
    let queryID = UUID()
    let query = HKStatisticsQuery(
      quantityType: steps,
      quantitySamplePredicate: predicate,
      options: .cumulativeSum
    ) { _, statistics, error in
      self.effectLock.lock(); defer { self.effectLock.unlock() }
      guard self.claimQuery(queryID) else { return }
      guard self.preEffectAuthority(authority, metric: "STEPS") else { return promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
      if let error {
        if self.isHealthDataRestricted(error) {
          return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
        }
        return promise.reject(error)
      }
      guard let sum = statistics?.sumQuantity() else {
        return promise.resolve(["state": "NO_DATA"])
      }
      let count = sum.doubleValue(for: HKUnit.count())
      promise.resolve([
        "state": "AVAILABLE",
        "count": count,
        "observedStartedAt": self.isoString(start),
        "observedEndedAt": self.isoString(end)
      ])
    }
    effectLock.lock(); defer { effectLock.unlock() }
    guard preEffectAuthority(authority, metric: authority["metric"] as? String ?? "") else { return promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
    activeQueries[queryID] = (query: query, promise: promise)
    healthStore.execute(query)
  }

  private func executeWorkoutQuery(
    workoutType: HKWorkoutType,
    start: Date,
    end: Date,
    authority: [String: Any],
    promise: Promise
  ) {
    let predicate = HKQuery.predicateForSamples(
      withStart: start,
      end: end,
      options: [.strictStartDate, .strictEndDate]
    )
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
    let queryID = UUID()
    let query = HKSampleQuery(
      sampleType: workoutType,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: [sort]
    ) { _, samples, error in
      self.effectLock.lock(); defer { self.effectLock.unlock() }
      guard self.claimQuery(queryID) else { return }
      guard self.preEffectAuthority(authority, metric: "WORKOUT") else { return promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
      if let error {
        if self.isHealthDataRestricted(error) {
          return promise.resolve(["state": "PLATFORM_UNAVAILABLE"])
        }
        return promise.reject(error)
      }
      let workouts = (samples as? [HKWorkout] ?? []).map { workout in
        [
          "category": self.normalizedWorkoutCategory(workout.workoutActivityType),
          "startedAt": self.isoString(workout.startDate),
          "endedAt": self.isoString(workout.endDate),
          "durationMinutes": max(0, workout.duration / 60.0)
        ] as [String: Any]
      }
      guard !workouts.isEmpty else {
        return promise.resolve(["state": "NO_DATA"])
      }
      promise.resolve(["state": "AVAILABLE", "workouts": workouts])
    }
    effectLock.lock(); defer { effectLock.unlock() }
    guard preEffectAuthority(authority, metric: authority["metric"] as? String ?? "") else { return promise.resolve(["state": "DISCARDED_STALE_EPOCH"]) }
    activeQueries[queryID] = (query: query, promise: promise)
    healthStore.execute(query)
  }

  private func requestedInterval(startedAt: String, endedAt: String) -> (start: Date, end: Date)? {
    guard let requestedStart = parseISODate(startedAt),
          let requestedEnd = parseISODate(endedAt),
          requestedStart <= requestedEnd,
          requestedEnd <= Date(),
          requestedStart >= Date().addingTimeInterval(-30 * 24 * 60 * 60),
          requestedEnd.timeIntervalSince(requestedStart) <= 30 * 24 * 60 * 60 else {
      return nil
    }
    return (requestedStart, requestedEnd)
  }

  private func parseISODate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) {
      return date
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
  }

  private func isoString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }

  private func isHealthDataRestricted(_ error: Error) -> Bool {
    guard let healthError = error as? HKError else {
      return false
    }
    return healthError.code == .errorHealthDataRestricted
  }

  private func normalizedWorkoutCategory(_ type: HKWorkoutActivityType) -> String {
    switch type {
    case .walking:
      return "WALK"
    case .running:
      return "RUN"
    case .cycling:
      return "CYCLE"
    case .traditionalStrengthTraining, .functionalStrengthTraining:
      return "STRENGTH"
    case .mixedCardio, .crossTraining, .highIntensityIntervalTraining:
      return "GENERAL"
    default:
      return "OTHER"
    }
  }
}
