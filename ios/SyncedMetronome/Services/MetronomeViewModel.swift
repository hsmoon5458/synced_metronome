import SwiftUI
import AVFoundation
import Combine

@MainActor
class MetronomeViewModel: ObservableObject {
    // MARK: - Published state
    @Published var bpm: Int = 120
    @Published var isRunning = false
    @Published var role: UserRole?
    @Published var timeSignature: TimeSignature = .fourFour
    @Published var subdivision: Subdivision = .eighth
    @Published var isConnected = false
    @Published var clientCount = 0
    @Published var hostAvailable = true
    @Published var latencyText = ""
    @Published var statusText = ""
    @Published var activeBeatIndex: Int = -1
    @Published var isAccentBeat = false
    @Published var flashTrigger = false

    // MARK: - Preset management
    @Published var presets: [Preset] = []

    // MARK: - Services
    private let socketService = SocketService()
    private let timeSyncService = TimeSyncService()
    private let audioEngine = AudioEngine()

    // MARK: - Internal state
    private var startTime: Double?
    private var tickTimer: Timer?
    private var beatCount: Int = 0
    private var nextTickAudioTime: Double = 0
    private var lastDriftCheck: Double = 0
    private var updateDebounceTask: Task<Void, Never>?
    private var pendingRole: UserRole?

    init() {
        loadPresets()
        setupSocketHandlers()
        wakeAndConnect()
    }

    // MARK: - Wake server + connect

    private func wakeAndConnect() {
        statusText = "Waking up server..."

        // Ping the server to trigger Render cold start, then connect Socket.IO
        Task {
            let url = URL(string: "\(SocketService.serverURL)/version")!
            for attempt in 1...10 {
                do {
                    let (_, response) = try await URLSession.shared.data(from: url)
                    if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                        statusText = "Connecting..."
                        socketService.connect()
                        return
                    }
                } catch {
                    // Server still waking up
                }
                statusText = "Waking up server (attempt \(attempt))..."
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
            statusText = "Server unreachable. Pull down to retry."
        }
    }

    // MARK: - Socket handlers

    private func setupSocketHandlers() {
        socketService.onConnect = { [weak self] in
            Task { @MainActor in
                guard let self = self else { return }
                self.isConnected = true
                self.statusText = ""

                // If a role was picked while connecting, identify now
                if let role = self.pendingRole {
                    self.pendingRole = nil
                    self.finalizeRole(role)
                } else if let role = self.role {
                    // Reconnection -- re-identify
                    self.socketService.identify(role: role.rawValue)
                    if role != .host {
                        _ = await self.performTimeSync(silent: true)
                    }
                }
            }
        }

        socketService.onDisconnect = { [weak self] in
            Task { @MainActor in
                self?.isConnected = false
                self?.statusText = "Reconnecting..."
            }
        }

        socketService.onSync = { [weak self] data in
            Task { @MainActor in
                self?.handleSync(data)
            }
        }

        socketService.onClientCount = { [weak self] count in
            Task { @MainActor in
                self?.clientCount = count
            }
        }

        socketService.onHostAvailability = { [weak self] available in
            Task { @MainActor in
                self?.hostAvailable = available
            }
        }

        socketService.onHostStatus = { [weak self] isHost, _ in
            Task { @MainActor in
                if !isHost {
                    // Server rejected host claim
                    self?.role = nil
                    self?.hostAvailable = false
                }
            }
        }
    }

    // MARK: - Role selection

    func setRole(_ newRole: UserRole) {
        role = newRole
        UIApplication.shared.isIdleTimerDisabled = true

        if isConnected {
            finalizeRole(newRole)
        } else {
            // Socket still connecting (server waking up) -- defer
            pendingRole = newRole
            statusText = "Connecting..."
        }
    }

    private func finalizeRole(_ selectedRole: UserRole) {
        Task {
            let success = await performTimeSync(silent: false)
            if success {
                socketService.identify(role: selectedRole.rawValue)
                if selectedRole != .host {
                    timeSyncService.startPeriodicReSync()
                }
            }
        }
    }

    // MARK: - Time sync

    private func performTimeSync(silent: Bool) async -> Bool {
        if !silent {
            latencyText = "Syncing with server..."
        }
        let success = await timeSyncService.syncTime()
        if success && !silent {
            latencyText = "Avg Latency: ~\(timeSyncService.avgLatency)ms"
        } else if !success && !silent {
            latencyText = "Time sync failed. Please retry."
        }
        return success
    }

    // MARK: - Sync handler

    private func handleSync(_ data: SyncData) {
        let wasRunning = isRunning

        bpm = data.bpm
        subdivision = Subdivision(rawValue: data.subdivision) ?? .eighth
        timeSignature = TimeSignature.allCases.first { $0.rawValue == data.timeSignature } ?? .fourFour
        isRunning = data.isRunning

        if !isRunning && wasRunning {
            stopTicking()
            activeBeatIndex = -1
            UIApplication.shared.isIdleTimerDisabled = (role != nil)
            return
        }

        if isRunning, let st = data.startTime {
            if wasRunning {
                stopTicking()
            }

            guard timeSyncService.isSynced else { return }
            UIApplication.shared.isIdleTimerDisabled = true
            startTime = st
            startMetronomeSync()
        }
    }

    // MARK: - Metronome tick engine

    private func startMetronomeSync() {
        audioEngine.restart()

        let now = timeSyncService.globalNow()
        guard let st = startTime else { return }

        let intervalMs = (60000.0 / Double(bpm)) / Double(subdivision.rawValue)
        let elapsedMs = now - st
        let ticksSinceStart = Int(floor(elapsedMs / intervalMs))
        let nextTickTimeMs = st + Double(ticksSinceStart + 1) * intervalMs
        let delayMs = nextTickTimeMs - now
        let delaySec = delayMs / 1000.0

        let hardwareLatency = audioEngine.outputLatency
        nextTickAudioTime = audioEngine.currentTime + delaySec - hardwareLatency
        lastDriftCheck = audioEngine.currentTime
        beatCount = ticksSinceStart + 1

        let clampedDelay = max(0, min(1.0, delayMs / 1000.0))

        DispatchQueue.main.asyncAfter(deadline: .now() + clampedDelay) { [weak self] in
            self?.tickLoop()
        }
    }

    private func tickLoop() {
        guard isRunning else { return }

        let interval = (60.0 / Double(bpm)) / Double(subdivision.rawValue)
        let now = audioEngine.currentTime
        let numerator = timeSignature.numerator
        let ticksPerBar = numerator * subdivision.rawValue

        // Drift correction for clients (host is timing anchor on the server)
        if role != .host, now - lastDriftCheck > 2.0, let st = startTime, timeSyncService.isSynced {
            lastDriftCheck = now
            let serverNow = timeSyncService.globalNow()
            let intervalMs = (60000.0 / Double(bpm)) / Double(subdivision.rawValue)
            let elapsedMs = serverNow - st
            let expectedBeat = Int(floor(elapsedMs / intervalMs))
            let expectedNextTickMs = st + Double(expectedBeat + 1) * intervalMs
            let hardwareLatency = audioEngine.outputLatency
            let expectedNextTickAudio = now + (expectedNextTickMs - serverNow) / 1000.0 - hardwareLatency
            let drift = nextTickAudioTime - expectedNextTickAudio
            if abs(drift) > 0.005 {
                nextTickAudioTime = expectedNextTickAudio
                beatCount = expectedBeat + 1
            }
        }

        while nextTickAudioTime < now + 0.3 {
            let currentBeat = beatCount / subdivision.rawValue
            let isFirstBeat = (beatCount % ticksPerBar == 0)
            let isMainBeat = (beatCount % subdivision.rawValue == 0)

            let scheduleTime = audioEngine.audioTime(afterSeconds: nextTickAudioTime - now)
            audioEngine.scheduleClick(at: scheduleTime, isAccent: isFirstBeat)

            if isMainBeat {
                let visualBeat = currentBeat % numerator
                let accent = isFirstBeat
                DispatchQueue.main.async { [weak self] in
                    self?.activeBeatIndex = visualBeat
                    self?.isAccentBeat = accent
                    self?.flashTrigger.toggle()
                }
            }

            nextTickAudioTime += interval
            beatCount += 1
        }

        tickTimer = Timer.scheduledTimer(withTimeInterval: 0.025, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.tickLoop()
            }
        }
    }

    private func stopTicking() {
        tickTimer?.invalidate()
        tickTimer = nil
    }

    // MARK: - Host controls

    func startMetronome() {
        guard role == .host else { return }
        UIApplication.shared.isIdleTimerDisabled = true
        socketService.startMetronome()
    }

    func stopMetronome() {
        guard role == .host else { return }
        isRunning = false
        stopTicking()
        activeBeatIndex = -1
        socketService.stopMetronome()
    }

    func changeBpm(_ delta: Int) {
        bpm = max(30, min(300, bpm + delta))
        sendSettingsUpdate()
    }

    func setBpm(_ newBpm: Int) {
        bpm = max(30, min(300, newBpm))
        sendSettingsUpdate()
    }

    func setTimeSignature(_ ts: TimeSignature) {
        timeSignature = ts
        sendSettingsUpdate()
    }

    func setSubdivision(_ sub: Subdivision) {
        subdivision = sub
        sendSettingsUpdate()
    }

    func debouncedBpmUpdate() {
        updateDebounceTask?.cancel()
        updateDebounceTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            sendSettingsUpdate()
        }
    }

    private func sendSettingsUpdate() {
        guard role == .host else { return }

        var st: Double? = nil
        if isRunning, startTime != nil {
            let delayMs = (nextTickAudioTime - audioEngine.currentTime) * 1000.0
            let nextBeatTime = timeSyncService.globalNow() + delayMs
            let newInterval = (60000.0 / Double(bpm)) / Double(subdivision.rawValue)
            st = nextBeatTime - (Double(beatCount) * newInterval)
        }

        socketService.updateSettings(
            bpm: bpm,
            timeSignature: timeSignature.rawValue,
            subdivision: subdivision.rawValue,
            startTime: st
        )
    }

    // MARK: - Presets

    func savePreset() {
        let preset = Preset(
            bpm: bpm,
            timeSignature: timeSignature.rawValue,
            subdivision: subdivision.rawValue
        )
        presets.append(preset)
        persistPresets()
    }

    func loadPreset(_ preset: Preset) {
        bpm = preset.bpm
        timeSignature = TimeSignature.allCases.first { $0.rawValue == preset.timeSignature } ?? .fourFour
        subdivision = Subdivision(rawValue: preset.subdivision) ?? .eighth
        sendSettingsUpdate()
    }

    func deletePreset(at offsets: IndexSet) {
        presets.remove(atOffsets: offsets)
        persistPresets()
    }

    func deletePreset(_ preset: Preset) {
        presets.removeAll { $0.id == preset.id }
        persistPresets()
    }

    private func loadPresets() {
        if let data = UserDefaults.standard.data(forKey: "metronomePresets"),
           let decoded = try? JSONDecoder().decode([Preset].self, from: data) {
            presets = decoded
        }
    }

    private func persistPresets() {
        if let encoded = try? JSONEncoder().encode(presets) {
            UserDefaults.standard.set(encoded, forKey: "metronomePresets")
        }
    }

    // MARK: - Cleanup

    func disconnect() {
        stopTicking()
        timeSyncService.stopPeriodicReSync()
        socketService.disconnect()
        audioEngine.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }
}
