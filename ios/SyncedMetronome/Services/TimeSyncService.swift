import Foundation

class TimeSyncService {
    private(set) var timeOffset: Double = 0
    private(set) var isSynced = false
    private(set) var isSyncing = false
    private(set) var avgLatency: Int = 0
    private var reSyncTimer: Timer?

    func globalNow() -> Double {
        return Date().timeIntervalSince1970 * 1000 + timeOffset
    }

    func syncTime() async -> Bool {
        guard !isSyncing else { return isSynced }
        isSyncing = true
        defer { isSyncing = false }

        var samples: [(roundTrip: Double, offset: Double)] = []
        guard let url = URL(string: "\(SocketService.serverURL)/time") else { return false }

        for _ in 0..<16 {
            let t0 = Date().timeIntervalSince1970 * 1000
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let t1 = Date().timeIntervalSince1970 * 1000
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let serverTime = json["serverTime"] as? Double {
                    let roundTrip = t1 - t0
                    let adjustedServerTime = serverTime + (roundTrip / 2)
                    let offset = adjustedServerTime - (Date().timeIntervalSince1970 * 1000)
                    samples.append((roundTrip: roundTrip, offset: offset))
                }
            } catch {
                continue
            }
            try? await Task.sleep(nanoseconds: UInt64((50 + Double.random(in: 0..<50)) * 1_000_000))
        }

        guard !samples.isEmpty else { return false }

        samples.sort { $0.roundTrip < $1.roundTrip }
        let bestCount = max(1, samples.count / 2)
        let bestSamples = Array(samples.prefix(bestCount))

        let sumOffset = bestSamples.reduce(0.0) { $0 + $1.offset }
        timeOffset = (sumOffset / Double(bestSamples.count)).rounded()

        let avgLat = bestSamples.reduce(0.0) { $0 + $1.roundTrip } / Double(bestSamples.count)
        avgLatency = Int(avgLat.rounded())

        isSynced = true
        return true
    }

    func startPeriodicReSync() {
        stopPeriodicReSync()
        reSyncTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self = self, self.isSynced else { return }
            Task { await self.syncTime() }
        }
    }

    func stopPeriodicReSync() {
        reSyncTimer?.invalidate()
        reSyncTimer = nil
    }
}
